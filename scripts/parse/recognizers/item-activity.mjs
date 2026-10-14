import { hasLang, languagesOf, ORIGIN } from "./common.mjs";
import { parseFormula } from "./damage.mjs";
import { lookup, fold, toNumber, NUMBER_RE } from "../lexicon/index.mjs";
import { splitSentences } from "../text.mjs";

/**
 * Recognizers for the activities of an item (C6, C7): how it is activated, healing, spell casting, charge
 * consumption, durations and the segmentation of the description. English and French.
 */

const ACTIVATION_EN = [
  /\b(?:use|using|uses)\s+(?:an?|your|its|the|one\s+of\s+your)\s+(bonus action|action|reaction)\b/iu,
  /\bas\s+(?:an?|your)\s+(bonus action|action|reaction)\b/iu,
  /\bwith\s+(?:an?|your)\s+(bonus action|action)\b/iu,
  /\btakes?\s+(?:an?|your)\s+(bonus action|action)\s+to\b/iu
];
const ACTIVATION_FR = [
  /\butilis(?:er|ez|e)\s+(?:une?|votre|son|sa)\s+(action bonus|action|r[ée]action)\b/iu,
  /\ben\s+(?:tant\s+qu'|tant\s+que\s+)?(?:une?\s+)?(action bonus|action|r[ée]action)\b/iu,
  /\bau\s+prix\s+d'(?:une?\s+)?(action bonus|action|r[ée]action)\b/iu,
  /\b(?:avec|par)\s+(?:une?|votre)\s+(action bonus|action|r[ée]action)\b/iu
];

const NUM = `(${NUMBER_RE})`;
const FORMULA = String.raw`\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+`;
const HEAL_EN = new RegExp(String.raw`\b(?:regains?|restores?|heals?|recovers?)\s+(?:up\s+to\s+)?(${FORMULA})\s+hit\s+points?\b`, "iu");
const HEAL_FR = new RegExp(String.raw`\b(?:regagn(?:e|ez|es|ent)|r[ée]cup[èéeê]r(?:e|ez|es|ent)|rend(?:ez|s)?|restaur(?:e|ez))\s+(?:jusqu'[àa]\s+)?(${FORMULA})\s+points?\s+de\s+vie\b`, "iu");
const CONSUME_EN = new RegExp(String.raw`\b(?:expend|expends|spend|spends)\s+${NUM}\s+(?:or\s+more\s+)?(?:of\s+(?:its|the)\s+)?charges?\b`, "iu");
const CONSUME_FR = new RegExp(String.raw`\bd[ée]pens(?:er|ez|e)\s+${NUM}\s+charges?(?:\s+ou\s+plus)?\b`, "iu");
const CAST_EN = /(?<!can't\s)(?<!cannot\s)(?<!not\s)\bcast\s+(?:the\s+)?([\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}?)(?:\s+spell)?(?:\s*\(([^)]*)\))?(?=\s*[.,;:]|\s+(?:from|with|using|by|at|as|once|without|requiring|expending|on|to|and|or|but|if)\b|\s*$)/iu;
const CAST_FR = /\blancer\s+(?:le\s+sort\s+)?([\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}?)(?:\s*\(([^)]*)\))?(?=\s*[.,;:]|\s+(?:depuis|avec|en|[àa]|au|par|une?|sans|et|ou|mais|si)\b|\s*$)/iu;
const NOT_SPELL = new Set(["a spell", "spell", "spells", "it", "them", "that spell", "the spell", "any spell", "one", "un sort", "le sort", "sort", "ce sort"]);
const DURATION_EN = /\bfor\s+(?:up\s+to\s+)?(\d+)\s+(rounds?|minutes?|hours?|days?)\b/iu;
const DURATION_FR = /\bpendant\s+(?:jusqu'[àa]\s+)?(\d+)\s+(rounds?|minutes?|heures?|jours?)\b/iu;
const TURN_END_EN = /\buntil\s+the\s+end\s+of\s+(?:your|its|their)\s+next\s+turn\b/iu;
const TURN_END_FR = /\bjusqu'[àa]\s+la\s+fin\s+de\s+votre\s+prochain\s+tour\b/iu;
const TRIGGER_EN = /\b(?:when|if|as soon as)\s+(?:you|a creature)\s+(?:drinks?|quaffs?|consumes?|eats?|reads?|applies|apply|uses?|activates?|swallows?)\b/iu;
const TRIGGER_FR = /\b(?:quand|lorsque|si)\s+(?:vous|une cr[ée]ature)\s+(?:buvez|boit|consommez|mangez|lisez|appliquez|utilisez|activez|avalez)\b/iu;
const PASSIVE_EN = /\bwhile\s+(?:you\s+(?:are\s+)?(?:wear|wearing|wield|wielding|carry|carrying|hold|holding|attuned)|it\s+is\s+(?:worn|wielded|carried|held)|wearing|wielding)\b/iu;
const PASSIVE_FR = /\btant\s+que\s+vous\s+(?:portez|maniez|tenez|portez\s+sur\s+vous|[êe]tes\s+(?:li[ée]|harmonis[ée]))\b/iu;

const DURATION_UNITS = { round: "rounds", minute: "minutes", hour: "hours", heure: "hours", day: "days", jour: "days" };

const SMALL_WORDS = new Set(["of", "the", "and", "de", "du", "des", "la", "le", "les", "d'", "l'", "et", "à", "au", "aux"]);
const titleCase = text => text.split(" ").map((word, index) => (index && SMALL_WORDS.has(word.toLowerCase())
  ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
const span = (kind, start, end, text) => ({ kind, start, end, text });
const wordOf = (match, index) => (match ? fold(match[index]).replace(/\s+/g, " ") : null);

/**
 * How the item is activated: "you can use an action to...", "as a bonus action", "utilisez une action bonus".
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ type: string, cost: null, raw: string, origin: string, index: number }|null}
 *   `index` is the offset of the activation phrase in `text` (not a plan field: removed by `parseItem`).
 */
export function recognizeItemActivation(text, ctx = {}) {
  const langs = languagesOf(ctx);
  const patterns = [...(hasLang(ctx, "en") ? ACTIVATION_EN : []), ...(hasLang(ctx, "fr") ? ACTIVATION_FR : [])];
  for ( const re of patterns ) {
    const match = String(text ?? "").match(re);
    if ( !match ) continue;
    const type = lookup("activation", wordOf(match, 1), langs);
    if ( type ) return { type, cost: null, raw: match[0], origin: ORIGIN, index: match.index };
  }
  return null;
}

/**
 * Healing ("regain 2d4 + 2 hit points").
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ part: object, span: object }|null}  `part` is a DamagePart with `type: "healing"`.
 */
export function recognizeHeal(text, ctx = {}) {
  const source = String(text ?? "");
  for ( const [re, lang] of [[HEAL_EN, "en"], [HEAL_FR, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const formula = match[1];
    const part = /d/i.test(formula)
      ? parseFormula(formula)
      : { number: null, denomination: null, bonus: String(Number(formula)) };
    return {
      part: { ...part, type: "healing", raw: match[0], origin: ORIGIN },
      span: span("heal", match.index, match.index + match[0].length, match[0])
    };
  }
  return null;
}

/**
 * Charge consumption ("expend 1 charge", "dépenser 1 charge").
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ consume: { target: "itemUses", amount: number, raw: string, origin: string }, span: object }|null}
 */
export function recognizeConsume(text, ctx = {}) {
  const source = String(text ?? "");
  for ( const [re, lang] of [[CONSUME_EN, "en"], [CONSUME_FR, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    const amount = match ? toNumber(match[1]) : null;
    if ( !match || !amount ) continue;
    return {
      consume: { target: "itemUses", amount, raw: match[0], origin: ORIGIN },
      span: span("consume", match.index, match.index + match[0].length, match[0])
    };
  }
  return null;
}

/**
 * Spell cast from the item ("you can cast fireball (save DC 15) from it", "lancer projectile magique").
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ cast: { name: string, level: number|null, dc: number|null, attack: number|null, charges: number|null,
 *   raw: string, origin: string }, span: object }|null}
 */
export function recognizeCast(text, ctx = {}) {
  const source = String(text ?? "");
  for ( const [re, lang] of [[CAST_EN, "en"], [CAST_FR, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const name = match[1].trim().replace(/^(?:the|le|la|les|l')\s*/i, "");
    if ( !name || NOT_SPELL.has(fold(name)) ) continue;
    const detail = match[2] ?? "";
    const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 120);
    // "DC 8 plus your Dexterity modifier" is a formula: not a fixed DC
    const dc = (detail.match(/\b(?:DC|DD)\s*(\d+)(?!\s*(?:\+|plus\b))/i)
      ?? source.match(/\b(?:save\s+DC|DD(?:\s+de\s+sauvegarde)?)\s*(\d+)(?!\s*(?:\+|plus\b))/i))?.[1];
    const attack = (detail.match(/\+(\d+)\s+(?:to\s+hit|au\s+toucher)/i))?.[1];
    const level = (detail + " " + tail).match(/\b(?:at\s+)?(\d)(?:st|nd|rd|th)[- ]level\b|\bau\s+niveau\s+(\d)\b|\bde\s+niveau\s+(\d)\b/i);
    const consume = recognizeConsume(source, ctx);
    return {
      cast: {
        name: titleCase(name), level: level ? Number(level[1] ?? level[2] ?? level[3]) : null,
        dc: dc ? Number(dc) : null, attack: attack ? Number(attack) : null, charges: consume?.consume.amount ?? null,
        raw: match[0], origin: ORIGIN
      },
      span: span("cast", match.index, match.index + match[0].length, match[0])
    };
  }
  return null;
}

/**
 * Duration of a temporary effect ("for 1 hour", "until the end of your next turn").
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ value: number, units: string }|null}
 */
export function recognizeDuration(text, ctx = {}) {
  const source = String(text ?? "");
  for ( const [re, lang] of [[DURATION_EN, "en"], [DURATION_FR, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const unit = DURATION_UNITS[fold(match[2]).replace(/s$/, "")];
    if ( unit ) return { value: Number(match[1]), units: unit };
  }
  if ( (hasLang(ctx, "en") && TURN_END_EN.test(source)) || (hasLang(ctx, "fr") && TURN_END_FR.test(source)) ) {
    return { value: 1, units: "turns" };
  }
  return null;
}

/**
 * Does the text say the effect applies when the item is used (drunk, read...) rather than carried?
 * @param {string} text
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function hasUseTrigger(text, ctx = {}) {
  const source = String(text ?? "");
  return (hasLang(ctx, "en") && TRIGGER_EN.test(source)) || (hasLang(ctx, "fr") && TRIGGER_FR.test(source));
}

/**
 * Does the text say the effect applies while the item is worn, wielded or carried?
 * @param {string} text
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function hasPassiveMarker(text, ctx = {}) {
  const source = String(text ?? "");
  return (hasLang(ctx, "en") && PASSIVE_EN.test(source)) || (hasLang(ctx, "fr") && PASSIVE_FR.test(source));
}

/**
 * Split the description into segments: one per paragraph, and inside a paragraph a new segment each time a
 * sentence gives a second activation.
 * @param {string} text  Plain text.
 * @param {object} [ctx]
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function segmentText(text, ctx = {}) {
  const source = String(text ?? "");
  const segments = [];
  let paragraphStart = 0;
  for ( const line of source.split("\n") ) {
    const paragraph = { start: paragraphStart, end: paragraphStart + line.length };
    paragraphStart += line.length + 1;
    if ( !line.trim() ) continue;
    let current = null;
    for ( const sentence of splitSentences(line) ) {
      const start = paragraph.start + sentence.index;
      const end = start + sentence.text.length;
      const activation = recognizeItemActivation(sentence.text, ctx);
      // A second activation starts a new segment only when the sentence is built around it ("You can use...")
      const leading = activation && /^(?:(?:you|vous)s+(?:can|may|pouvez)s+|ass+|ens+tants+|usings+)?$/iu
        .test(sentence.text.slice(0, activation.index));
      if ( current && leading && current.activated ) {
        segments.push(current);
        current = null;
      }
      if ( !current ) current = { start, end, activated: false };
      current.end = end;
      if ( activation ) current.activated = true;
    }
    if ( current ) segments.push(current);
  }
  return segments.map(({ start, end }) => ({ text: source.slice(start, end), start, end }));
}
