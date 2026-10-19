import { isValidKey } from "./keys.mjs";

const TRAIT_KINDS = ["dr", "di", "dv", "ci"];
const KEY_SET = { dr: "damageTypes", di: "damageTypes", dv: "damageTypes", ci: "conditionTypes" };
const MAX_SPELL_LEVEL = 9;

const toArray = value => value ? Array.from(value) : [];

/**
 * Translate one trait of the plan into a patch, as a union with what the actor already has.
 * @returns {{ patch: object|null, notes: object[] }}
 */
function traitPatch(kind, planned, existing, keys) {
  const notes = [];
  const have = toArray(existing?.value);
  const haveBypasses = toArray(existing?.bypasses);
  const haveCustom = String(existing?.custom ?? "").split(";").map(s => s.trim()).filter(Boolean);

  const added = [];
  const customAdded = [];
  for ( const value of planned.values ) {
    if ( !isValidKey(keys, KEY_SET[kind], value) ) {
      notes.push({ key: "dnd5e-text-parser.Note.TraitKeyInvalid", data: { kind, value } });
      customAdded.push(value);
    }
    else if ( !have.includes(value) && !added.includes(value) ) added.push(value);
  }
  for ( const text of planned.custom ) customAdded.push(text);

  const patch = {};
  if ( added.length ) patch.value = [...have, ...added];

  const wantedBypasses = planned.bypasses.filter(b => !haveBypasses.includes(b));
  if ( wantedBypasses.length && planned.values.length ) {
    // `bypasses` applies to the whole trait: never widen it over values the text does not cover.
    if ( have.every(value => planned.values.includes(value)) ) patch.bypasses = [...haveBypasses, ...wantedBypasses];
    else notes.push({ key: "dnd5e-text-parser.Note.TraitBypassSkipped", data: { kind, bypasses: wantedBypasses } });
  }

  const customNew = customAdded.filter((text, i) => customAdded.indexOf(text) === i
    && !haveCustom.some(c => c.toLowerCase() === text.toLowerCase()));
  if ( customNew.length ) patch.custom = [...haveCustom, ...customNew].join("; ");

  return { patch: Object.keys(patch).length ? patch : null, notes };
}

/**
 * Translate an ActorPlan into a partial dnd5e actor `system` (C11, C12, C13, C22).
 * Traits are a union with `actor.system.traits`: apply them as-is, not with an "empty fields only" merge.
 * The other values are plain targets for `mergeMissing`.
 * @param {object} actorPlan
 * @param {{ keys?: object, actor?: object }} [options]
 * @returns {{ system: object, notes: object[] }}
 */
export function toActorPatch(actorPlan, { keys, actor } = {}) {
  const system = {};
  const notes = [];

  const resources = {};
  if ( actorPlan?.legact > 0 ) resources.legact = { max: actorPlan.legact };
  if ( actorPlan?.legres > 0 ) resources.legres = { max: actorPlan.legres };
  if ( Object.keys(resources).length ) system.resources = resources;

  const traits = {};
  for ( const kind of TRAIT_KINDS ) {
    const planned = actorPlan?.traits?.[kind];
    if ( !planned ) continue;
    const result = traitPatch(kind, planned, actor?.system?.traits?.[kind], keys);
    notes.push(...result.notes);
    if ( result.patch ) traits[kind] = result.patch;
  }
  if ( Object.keys(traits).length ) system.traits = traits;

  const plans = actorPlan?.spellcasting ?? [];
  const regular = plans.filter(p => !p.innate);
  const abilityPlans = [...regular, ...plans.filter(p => p.innate)].filter(p => p.ability);
  const attributes = {};
  const ability = abilityPlans.find(p => isValidKey(keys, "abilities", p.ability))?.ability;
  if ( ability ) attributes.spellcasting = ability;
  const abilities = [...new Set(abilityPlans.map(p => p.ability))];
  if ( abilities.length > 1 ) notes.push({ key: "dnd5e-text-parser.Note.SpellcastingAbilityConflict", data: { abilities } });
  const casterLevel = regular.find(p => Number.isInteger(p.casterLevel))?.casterLevel;
  if ( casterLevel !== undefined ) attributes.spell = { level: casterLevel };
  if ( Object.keys(attributes).length ) system.attributes = attributes;

  const spells = {};
  for ( const plan of regular ) {
    for ( const list of plan.lists ?? [] ) {
      if ( list.mode !== "slots" || !Number.isInteger(list.slots) ) continue;
      if ( !Number.isInteger(list.level) || list.level < 1 || list.level > MAX_SPELL_LEVEL ) continue;
      spells[`spell${list.level}`] ??= { value: list.slots, override: list.slots };
    }
  }
  if ( Object.keys(spells).length ) system.spells = spells;

  return { system, notes };
}

/**
 * Minimal spell items for a spell list: name, type and how it is cast, nothing else (no invented content).
 * At-will and cantrip lists give `method: "atwill"`; "N/day" gives `innate` with N uses per day; slot lists
 * give `spell` with the list level. The level of innate and at-will spells is left to the compendium.
 * @param {object} spellcastingPlan
 * @returns {{ name: string, type: "spell", system: object }[]}
 */
export function toSpellStubs(spellcastingPlan) {
  const stubs = [];
  for ( const list of spellcastingPlan?.lists ?? [] ) {
    for ( const name of list.spells ?? [] ) {
      const system = { prepared: 1 };
      if ( list.mode === "slots" ) {
        system.method = "spell";
        system.level = list.level;
      } else if ( list.mode === "innate" ) {
        system.method = "innate";
        system.uses = { max: String(list.uses), recovery: [{ period: "day", type: "recoverAll" }] };
      } else {
        system.method = "atwill";
        if ( list.mode === "cantrip" ) system.level = 0;
      }
      stubs.push({ name, type: "spell", system });
    }
  }
  return stubs;
}
