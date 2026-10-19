import { htmlToText } from "./text.mjs";
import { parseFeature } from "./plan.mjs";
import { parseSpellcasting, isSpellcastingName } from "./spellcasting.mjs";
import { recognizeLegendary } from "./recognizers/legendary.mjs";
import { recognizeTraits, parseTraitBody } from "./recognizers/traits.mjs";

const TRAIT_KINDS = ["dr", "di", "dv", "ci"];
const SCHEMA = 1;

const emptyTrait = () => ({ values: [], bypasses: [], custom: [] });

/**
 * Add the entries of `from` that `into` does not have yet.
 * @param {{values: string[], bypasses: string[], custom: string[]}} into
 * @param {{values: string[], bypasses: string[], custom: string[]}} from
 */
function mergeTrait(into, from) {
  for ( const part of ["values", "bypasses", "custom"] ) {
    for ( const entry of from[part] ) if ( !into[part].includes(entry) ) into[part].push(entry);
  }
}

/**
 * Parse a dnd5e NPC source (`actor.toObject()` or a compendium JSON entry) into an ActorPlan.
 * Scans each item description, the biography and the `traits.*.custom` strings. Pure.
 * Re-exported by `plan.mjs`.
 * @param {object} actor  dnd5e actor source (`system`, `items[]`).
 * @param {object} [opts]  ParseOptions (forwarded to `parseFeature`).
 * @returns {object} ActorPlan
 */
export function parseActor(actor, opts = {}) {
  const plan = {
    schema: SCHEMA, legact: null, legres: null,
    traits: { dr: emptyTrait(), di: emptyTrait(), dv: emptyTrait(), ci: emptyTrait() },
    spellcasting: [], features: new Map(), notes: [], ambiguous: []
  };
  const sources = [];
  const biography = actor?.system?.details?.biography?.value;
  if ( biography ) sources.push({ name: "", text: htmlToText(biography) });

  for ( const item of Array.from(actor?.items ?? []) ) {
    const html = item?.system?.description?.value ?? "";
    const name = item?.name ?? "";
    sources.push({ name, text: htmlToText(html) });
    if ( item?.type === "spell" ) continue;
    if ( isSpellcastingName(name) ) {
      const spellcasting = parseSpellcasting(html, { ...opts, name });
      if ( spellcasting ) plan.spellcasting.push(spellcasting);
    }
    plan.features.set(item._id ?? item.id ?? String(plan.features.size), parseFeature(name, html, opts));
  }

  const found = { legact: [], legres: [] };
  for ( const { name, text } of sources ) {
    const legendary = recognizeLegendary(name ? `${name}\n${text}` : text);
    for ( const key of ["legact", "legres"] ) {
      if ( legendary.fact[key] !== null ) found[key].push(legendary.fact[key]);
    }
    plan.ambiguous.push(...legendary.ambiguous);
    const traits = recognizeTraits(text);
    for ( const kind of TRAIT_KINDS ) mergeTrait(plan.traits[kind], traits.fact[kind]);
    plan.ambiguous.push(...traits.ambiguous);
  }
  for ( const key of ["legact", "legres"] ) {
    plan[key] = found[key][0] ?? null;
    const distinct = [...new Set(found[key])];
    if ( distinct.length > 1 ) {
      plan.ambiguous.push({ key: "dnd5e-text-parser.Note.LegendaryConflict", data: { kind: key, values: distinct } });
    }
  }

  // Strings already stored on the actor ("Fire; Nonmagical Bludgeoning…") are read as lists too.
  for ( const kind of TRAIT_KINDS ) {
    const custom = actor?.system?.traits?.[kind]?.custom;
    if ( !custom ) continue;
    mergeTrait(plan.traits[kind], parseTraitBody(custom, kind).traits[kind]);
  }
  return plan;
}
