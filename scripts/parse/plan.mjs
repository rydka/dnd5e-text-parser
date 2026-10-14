import { htmlToText, splitSentences, nameKey } from "./text.mjs";
import { recognizeAttack } from "./recognizers/attack.mjs";
import { recognizeRangeTarget } from "./recognizers/range-target.mjs";
import { recognizeDamage } from "./recognizers/damage.mjs";
import { recognizeSaveArea } from "./recognizers/save-area.mjs";
import { recognizeUses } from "./recognizers/uses.mjs";
import { recognizeActivation } from "./recognizers/activation.mjs";
import { recognizeLegendary } from "./recognizers/legendary.mjs";

export { nameKey } from "./text.mjs";
export { parseActor } from "./actor-plan.mjs";
export { parseItem } from "./item-plan.mjs";

const SCHEMA_VERSION = 1;
const MULTIATTACK = /^(?:multiattack|attaques? multiples?)(?![\p{L}])/u;

/** An empty `FeaturePlan`. */
function emptyPlan() {
  return {
    schema: SCHEMA_VERSION, skip: null, activation: null, attack: null, range: null, target: null, damage: [],
    save: null, template: null, uses: null, recharge: null, legendaryResistance: null,
    notes: [], ambiguous: [], unrecognized: []
  };
}

// "at the start of each of its turns", "au début de chacun de ses tours"
const ONGOING_PHRASE = String.raw`(?:(?:at\s+the\s+)?(?:start|beginning|end)\s+of\s+(?:each\s+of\s+|every\s+|(?:its|their|the\s+target's)\s+)` +
  String.raw`(?:its\s+|their\s+)?turns?|au\s+(?:d[ée]but|fin)\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?|` +
  String.raw`[àa]\s+la\s+fin\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?)`;
const ONGOING_AFTER = new RegExp(String.raw`^[^.]{0,40}?${ONGOING_PHRASE}`, "iu");
const ONGOING_BEFORE = new RegExp(String.raw`${ONGOING_PHRASE}[^.]{0,40}$`, "iu");
const overlaps = (span, other) => span.start < other.end && span.end > other.start;

/**
 * Parse the text of a feature (monster action, trait, item) into a `FeaturePlan` (pure, deterministic).
 * Multiattack is never interpreted (`skip: "multiattack"`). Nothing is invented: ambiguous facts are left out
 * and listed in `ambiguous`; sentences no recognizer covered are listed in `unrecognized`.
 * @param {string} name  Feature name (may carry "(Recharge 5-6)", "(3/Day)", "(Costs 2 Actions)").
 * @param {string} html  Description (HTML or plain text).
 * @param {{ languages?: ("en"|"fr")[], keys?: object }} [opts]
 * @returns {object} FeaturePlan
 */
export function parseFeature(name, html, opts = {}) {
  const plan = emptyPlan();
  const title = String(name ?? "");
  if ( MULTIATTACK.test(nameKey(title)) ) {
    plan.skip = "multiattack";
    return plan;
  }
  const text = htmlToText(html);
  const ctx = { languages: opts.languages, keys: opts.keys, name: title, html: String(html ?? "") };

  const attack = recognizeAttack(text, ctx);
  const rangeTarget = recognizeRangeTarget(text, ctx);
  const damage = recognizeDamage(text, ctx);
  const saveArea = recognizeSaveArea(text, ctx);
  const uses = recognizeUses(text, ctx);
  const activation = recognizeActivation(text, ctx);
  const offset = title.length + 1;
  const legendary = recognizeLegendary(`${title}\n${text}`);
  const legendarySpans = (legendary.spans ?? [])
    .map(span => ({ ...span, start: span.start - offset, end: span.end - offset })).filter(span => span.end > 0);

  const results = [attack, rangeTarget, damage, saveArea, uses, activation, legendary];
  for ( const result of results ) {
    plan.ambiguous.push(...(result.ambiguous ?? []));
    plan.notes.push(...(result.notes ?? []));
  }

  plan.activation = activation.fact;
  plan.attack = attack.fact;
  plan.range = rangeTarget.fact.range;
  plan.target = rangeTarget.fact.target;
  plan.save = saveArea.fact.save;
  plan.template = saveArea.fact.template;
  plan.uses = uses.fact.uses;
  plan.recharge = uses.fact.recharge;
  plan.legendaryResistance = legendary.fact?.legres ?? null;
  // Legendary Resistance is a trait, even when filed under a "Legendary Actions" header (C12)
  if ( plan.legendaryResistance && plan.activation?.type === "legendary" ) plan.activation = null;

  // Attack type from the range when the text has no "Melee"/"Ranged" header
  if ( plan.attack && !plan.attack.type && plan.range ) {
    const { reach, value } = plan.range;
    if ( reach !== null ) plan.attack.type = "melee";
    else if ( value !== null ) plan.attack.type = "ranged";
    if ( reach !== null && value !== null ) {
      plan.notes.push({ key: "dnd5e-text-parser.Note.RangeNotCarried", data: { reach, value } });
    }
  }

  // Damage: on hit (before the save) or damage alone; damage of the save after it
  const saveSpan = saveArea.spans.find(span => span.kind === "save");
  const saveStart = plan.save && saveSpan ? saveSpan.start : Infinity;
  const chains = [];
  let cursor = 0;
  for ( const chain of damage.chains ) {
    chains.push({ parts: chain, start: damage.spans[cursor].start, end: damage.spans[cursor + chain.length - 1].end });
    cursor += chain.length;
  }
  const before = chains.filter(chain => chain.start < saveStart);
  const after = chains.filter(chain => chain.start >= saveStart);
  let hit = null;
  let onSave;
  // C4: damage that depends on an ambiguous save (several different saving throws, "Wall of Ice") is withheld with
  // it: no damage activity is invented for an ability whose damage belongs to the unresolved save. An ambiguous
  // attack (several bonuses) keeps its written damage: only the bonus is left out (L3, nothing invented).
  const withheld = !plan.save && saveArea.ambiguous?.length;
  if ( withheld ) {
    if ( chains.length ) {
      plan.ambiguous.push({ key: "dnd5e-text-parser.Note.DamageWithheld", data: { raw: chains.flatMap(chain => chain.parts.map(part => part.raw)) } });
    }
    onSave = null;
  } else if ( plan.save && !plan.attack ) {
    onSave = after[0] ?? before[0] ?? null;
  } else {
    hit = before[0] ?? (plan.save ? null : chains[0]) ?? null;
    onSave = plan.save ? (after[0] ?? null) : null;
  }
  if ( hit ) plan.damage = hit.parts;
  if ( plan.save && onSave ) plan.save.damage = onSave.parts;
  for ( const chain of chains ) {
    if ( withheld || chain === hit || chain === onSave ) continue;
    // Ongoing damage of a follow-up sentence ("takes 5 (1d10) fire damage at the start of each of its turns")
    if ( hit && (ONGOING_AFTER.test(text.slice(chain.end, chain.end + 80))
      || ONGOING_BEFORE.test(text.slice(Math.max(0, chain.start - 90), chain.start))) ) {
      plan.damage.push(...chain.parts);
      continue;
    }
    plan.notes.push({ key: "dnd5e-text-parser.Note.ExtraDamageIgnored", data: { raw: chain.parts.map(part => part.raw) } });
  }

  // Sentences that no recognizer covered
  const spans = [...attack.spans, ...rangeTarget.spans, ...damage.spans, ...saveArea.spans, ...uses.spans,
    ...activation.spans, ...legendarySpans];
  for ( const sentence of splitSentences(text) ) {
    const words = sentence.text.replace(/[:.]+$/, "").split(/\s+/).filter(Boolean);
    if ( words.length < 2 || !/[\p{L}\d]/u.test(sentence.text) ) continue;
    const span = { start: sentence.index, end: sentence.index + sentence.text.length };
    if ( spans.some(other => overlaps(span, other)) ) continue;
    plan.unrecognized.push({ text: sentence.text, index: sentence.index });
  }
  return plan;
}
