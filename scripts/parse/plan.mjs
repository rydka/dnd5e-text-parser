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

// "at the start of each of its turns", "at the start of each of the behir's turns", "au début de chacun de ses tours"
const ONGOING_PHRASE = String.raw`(?:(?:at\s+the\s+)?(?:start|beginning|end)\s+of\s+(?:(?:each\s+of|every)\s+)?` +
  String.raw`(?:(?:its|their|the\s+(?:[\p{L}-]+\s+){0,2}?[\p{L}-]+'s)\s+)?turns?|` +
  String.raw`au\s+(?:d[ée]but|fin)\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?|` +
  String.raw`[àa]\s+la\s+fin\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?)`;
const ONGOING_AFTER = new RegExp(String.raw`^[^.]{0,40}?${ONGOING_PHRASE}`, "iu");
// "...at the start of each of its turns or take 12 (2d8 + 3) damage" is the damage of a repeated save, not ongoing
const ONGOING_BEFORE = new RegExp(String.raw`${ONGOING_PHRASE}(?:(?!\b(?:or|ou)\s+(?:takes?|subit))[^.]){0,40}$`, "iu");
const overlaps = (span, other) => span.start < other.end && span.end > other.start;
// Second result: "6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the creature is Bloodied"
const ALT_SEP = /^\s*,?\s*(?:or|ou)\s+(?:(?:an?|une?)\s+)?(?:(?:extra|additional|suppl[ée]mentaires?)\s+)?$/iu;
const ALT_AFTER = /^\s*(?:if|when|while|unless|si|lorsque|quand)(?![\p{L}])/iu;

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
  // Ongoing damage of a condition ("takes 21 (6d6) acid damage at the start of each of its turns" while swallowed,
  // poisoned, grappled...) is never the damage of a saving throw: it rides on the attack when there is one, else it
  // stands as its own damage activity next to the save (`toActivities`).
  const isOngoing = chain => ONGOING_AFTER.test(text.slice(chain.end, chain.end + 80))
    || ONGOING_BEFORE.test(text.slice(Math.max(0, chain.start - 90), chain.start));
  const direct = chains.filter(chain => !isOngoing(chain));
  const before = direct.filter(chain => chain.start < saveStart);
  const after = direct.filter(chain => chain.start >= saveStart);
  let hit = null;
  let onSave;
  // C4: damage that depends on an ambiguous save (several different saving throws, "Wall of Ice") is withheld with
  // it: no damage activity is invented for an ability whose damage belongs to the unresolved save. An ambiguous
  // attack (several bonuses) keeps its written damage: only the bonus is left out (L3, nothing invented).
  const withheld = !plan.save && saveArea.ambiguous?.length;
  if ( withheld ) {
    if ( direct.length ) {
      plan.ambiguous.push({ key: "dnd5e-text-parser.Note.DamageWithheld", data: { raw: direct.flatMap(chain => chain.parts.map(part => part.raw)) } });
    }
    onSave = null;
  } else if ( plan.save && !plan.attack ) {
    onSave = after[0] ?? before[0] ?? null;
  } else {
    hit = before[0] ?? (plan.save ? null : direct[0]) ?? null;
    onSave = plan.save ? (after[0] ?? null) : null;
  }
  if ( hit ) plan.damage = hit.parts;
  if ( plan.save && onSave ) plan.save.damage = onSave.parts;
  let previous = null;   // chain just before in text order, with the list its parts went to
  for ( const chain of chains ) {
    let list = null;
    if ( chain === hit ) list = plan.damage;
    else if ( chain === onSave ) list = plan.save.damage;
    else if ( isOngoing(chain) ) {
      plan.damage.push(...chain.parts);
      list = plan.damage;
    } else if ( previous?.list && ALT_SEP.test(text.slice(previous.chain.end, chain.start))
      && ALT_AFTER.test(text.slice(chain.end, chain.end + 12)) ) {
      // A second result ("or N (dice) type damage if ...") follows the result it replaces, with its condition
      const condition = text.slice(chain.end).match(/^\s*[^.;\n]{0,120}/u)[0].trim();
      for ( const part of chain.parts ) previous.list.push({ ...part, condition });
      list = previous.list;
    } else if ( !withheld ) {
      plan.notes.push({ key: "dnd5e-text-parser.Note.ExtraDamageIgnored", data: { raw: chain.parts.map(part => part.raw) } });
    }
    previous = { chain, list };
  }

  // Sentences that no recognizer covered
  const spans = [...attack.spans, ...rangeTarget.spans, ...damage.spans, ...(damage.covered ?? []), ...saveArea.spans,
    ...uses.spans, ...activation.spans, ...legendarySpans];
  for ( const sentence of splitSentences(text) ) {
    const words = sentence.text.replace(/[:.]+$/, "").split(/\s+/).filter(Boolean);
    if ( words.length < 2 || !/[\p{L}\d]/u.test(sentence.text) ) continue;
    const span = { start: sentence.index, end: sentence.index + sentence.text.length };
    if ( spans.some(other => overlaps(span, other)) ) continue;
    plan.unrecognized.push({ text: sentence.text, index: sentence.index });
  }
  return plan;
}
