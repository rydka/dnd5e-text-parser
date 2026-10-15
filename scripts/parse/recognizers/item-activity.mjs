import { hasLang, languagesOf, ORIGIN } from "./common.mjs";
import { lookup, fold, toNumber, abilityKey, NUMBER_RE } from "../lexicon/index.mjs";
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
// A healing formula: dice and numbers, plus "your proficiency bonus" (@prof) and "your Wisdom modifier"
// (@abilities.wis.mod), "votre bonus de maîtrise", "votre modificateur de Sagesse"
const TERM = String.raw`\d+\s*d\s*\d+|\d+|(?:your|its)\s+proficiency\s+bonus|(?:votre|son)\s+bonus\s+de\s+ma[îi]trise|` +
  String.raw`(?:your|its)\s+\p{L}+\s+modifier|(?:votre|son)\s+modificateur\s+(?:de\s+|d')\p{L}+`;
const FORMULA = String.raw`(?:${TERM})(?:\s*[+-]\s*(?:${TERM}))*`;
const HEAL_WORDS_EN = String.raw`(?:regains?|restores?|heals?|recovers?)`;
const HEAL_WORDS_FR = String.raw`(?:regagn(?:e|ez|es|ent)|r[ée]cup[èéeê]r(?:e|ez|es|ent)|rend(?:ez|s)?|restaur(?:e|ez))`;
const GAIN_FR = String.raw`gagn(?:e|ez|es|ent)\s+(?:[ée]galement\s+|aussi\s+)?`;
const HEAL_EN = new RegExp(String.raw`\b${HEAL_WORDS_EN}\s+(?:up\s+to\s+)?(${FORMULA})\s+hit\s+points?\b|` +
  String.raw`\b${HEAL_WORDS_EN}\s+(?:a\s+number\s+of\s+)?hit\s+points?\s+equal\s+to\s+(${FORMULA})`, "iu");
const HEAL_FR = new RegExp(String.raw`\b${HEAL_WORDS_FR}\s+(?:jusqu'[àa]\s+)?(${FORMULA})\s+(?:points?\s+de\s+vie|hit\s+points?)\b|` +
  String.raw`\b${HEAL_WORDS_FR}\s+(?:un\s+nombre\s+de\s+)?points?\s+de\s+vie\s+[ée]ga(?:l|ux)\s+[àa]\s+(${FORMULA})`, "iu");
// "gain 1d6 temporary hit points", "gain temporary hit points equal to 1d6 + your proficiency bonus",
// "gagnez 5 points de vie temporaires", "gagnez un nombre de points de vie temporaires égal à 1d6 + votre bonus de maîtrise"
const TEMP_EN = new RegExp(String.raw`\b(?:gains?|receives?|has)\s+(${FORMULA})\s+temporary\s+hit\s+points?\b|` +
  String.raw`\b(?:gains?|receives?)\s+(?:a\s+number\s+of\s+)?temporary\s+hit\s+points?\s+equal\s+to\s+(${FORMULA})`, "iu");
const TEMP_FR = new RegExp(String.raw`\b${GAIN_FR}(${FORMULA})\s+points?\s+de\s+vie\s+temporaires?\b|` +
  String.raw`\b${GAIN_FR}(?:un\s+nombre\s+de\s+)?points?\s+de\s+vie\s+temporaires?\s+[ée]ga(?:l|ux)\s+[àa]\s+(${FORMULA})`, "iu");
const PROF = /^(?:your|its)\s+proficiency\s+bonus$|^(?:votre|son)\s+bonus\s+de\s+ma[îi]trise$/iu;
const MOD = /^(?:your|its)\s+(\p{L}+)\s+modifier$|^(?:votre|son)\s+modificateur\s+(?:de\s+|d')(\p{L}+)$/iu;
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

// A paragraph that continues the previous property: "When you use this property, ...", "Whenever you do so, ...",
// "Lorsque vous utilisez cette propriété, ...", "Ce faisant, ...". An optional short lead-in ("Borrowed Breath.")
// may precede it.
const LEAD_IN = String.raw`(?:[^.!?\n]{2,60}?\.\s+)?`;
const REFERS_EN = new RegExp(String.raw`^${LEAD_IN}(?:(?:when|whenever|if|each\s+time|every\s+time|after)\s+you\s+` +
  String.raw`(?:use|activate|invoke)\s+(?:this|that|the)\s+(?:property|feature|ability|effect|power)|when(?:ever)?\s+you\s+do\s+so)(?![\p{L}])`, "iu");
const REFERS_FR = new RegExp(String.raw`^${LEAD_IN}(?:(?:lorsque|quand|chaque\s+fois\s+que|si|apr[èe]s\s+que)\s+vous\s+` +
  String.raw`(?:utilisez|activez|invoquez|faites\s+appel\s+[àa])\s+(?:cette|ce|cet)\s+(?:propri[ée]t[ée]|capacit[ée]|pouvoir|effet|aptitude|facult[ée])|` +
  String.raw`lorsque\s+vous\s+le\s+faites|ce\s+faisant)(?![\p{L}])`, "iu");

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
 * Dice and bonus of a healing formula ("2d4 + 2", "1d6 + your proficiency bonus", "5"): the first dice term gives
 * `number` / `denomination`, the other terms the `bonus` (a dnd5e roll formula: "@prof", "@abilities.wis.mod").
 * `null` when a modifier names an unknown ability.
 * @param {string} formula
 * @returns {{ number: number|null, denomination: number|null, bonus: string }|null}
 */
function healFormula(formula) {
  const terms = formula.match(/[+-]?\s*[^+-]+/g) ?? [];
  const part = { number: null, denomination: null, bonus: "" };
  for ( const term of terms ) {
    const sign = term.trim().startsWith("-") ? "-" : "+";
    const body = term.replace(/^[+-]\s*/, "").trim();
    if ( !body ) continue;
    const dice = body.match(/^(\d+)\s*d\s*(\d+)$/i);
    let value;
    if ( dice && part.number === null && sign === "+" ) { part.number = Number(dice[1]); part.denomination = Number(dice[2]); continue; }
    else if ( dice ) value = `${dice[1]}d${dice[2]}`;
    else if ( /^\d+$/.test(body) ) value = String(Number(body));
    else if ( PROF.test(body) ) value = "@prof";
    else {
      const mod = body.match(MOD);
      const ability = mod ? abilityKey(mod[1] ?? mod[2]) : null;
      if ( !ability ) return null;
      value = `@abilities.${ability}.mod`;
    }
    part.bonus += part.bonus ? ` ${sign} ${value}` : (sign === "-" ? `-${value}` : value);
  }
  return part;
}

/**
 * Healing ("regain 2d4 + 2 hit points", "regagnez 10 points de vie") or temporary hit points ("gain 1d6
 * temporary hit points", "gain temporary hit points equal to 1d6 + your proficiency bonus", "gagnez un nombre de
 * points de vie temporaires égal à 1d6 + votre bonus de maîtrise").
 * @param {string} text
 * @param {object} [ctx]
 * @returns {{ part: object, span: object }|null}  `part` is a DamagePart with `type: "healing"` or `"temphp"`;
 *   "your proficiency bonus" / "votre bonus de maîtrise" gives `@prof` in `bonus`, an ability modifier
 *   `@abilities.<key>.mod`.
 */
export function recognizeHeal(text, ctx = {}) {
  const source = String(text ?? "");
  const patterns = [[TEMP_EN, "en", "temphp"], [TEMP_FR, "fr", "temphp"], [HEAL_EN, "en", "healing"], [HEAL_FR, "fr", "healing"]];
  for ( const [re, lang, type] of patterns ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const part = healFormula(match[1] ?? match[2]);
    if ( !part ) continue;
    return {
      part: { ...part, type, raw: match[0], origin: ORIGIN },
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
    const name = match[1].trim().replace(/^(?:(?:the|le|la|les)\s+|l')/i, "");
    if ( !name || NOT_SPELL.has(fold(name)) || /\b(?:following|suivants?)\b/i.test(name) ) continue;
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

// "expend 1 or more of its charges to cast one of the following spells:" (DMG 2014),
// "you can cast one of the spells on the following table from it" (DMG 2024, table of spell and charge cost)
const LIST_INTRO_EN = /\bexpend\s+(?:\d+|one|an?)(?:\s+or\s+more)?\s+(?:of\s+(?:its|the)\s+)?charges?\s+to\s+cast\s+(?:one\s+of\s+)?(?:the\s+following|these)\s+spells?\b[^:\n]*:?|\bcast\s+one\s+of\s+the\s+spells\s+(?:on|in|from)\s+the\s+(?:following\s+)?table\b[^:\n]*:?/iu;
// "dépenser 1 ou plusieurs de ses charges afin de lancer l'un des sorts suivants", "dépenser des charges pour lancer…"
const LIST_INTRO_FR = /\bd[ée]penser\s+(?:\d+|une?|des)\s+(?:ou\s+plusieurs\s+)?(?:de\s+(?:ses|les)\s+)?charges?(?:\s+ou\s+plus)?\s+(?:afin\s+de|pour)\s+lancer\s+l'un\s+des\s+sorts\s+suivants\b[^:\n]*:?/iu;
const LIST_ENTRY = /(?<![\p{L}'-])([\p{L}][\p{L}' -]*?)\s*\(([^()]*?)(\d+)\s+charges?\)/giu;
// Table row: "Ice Storm 4", "Fireball (5th-level version) 5 charges", "Ray of Frost 1 charge per spell level (maximum 2…)"
const LIST_ROW = /^([\p{L}][^\d\n]*?(?:\([^)\n]*\))?)\s+(\d+)(?:\s+charges?(?:\s+(?:per\s+spell\s+level|par\s+niveau\s+de\s+sort)\b[^\n]*)?)?$/iu;
const LIST_LEVEL = /(\d)(?:st|nd|rd|th)[- ]level|niveau\s+(\d)/iu;

/**
 * Spells a staff or wand casts for charges ("expend 1 or more of its charges to cast one of the following spells:
 * cone of cold (5 charges), fireball (5th-level version, 5 charges)", or a table of spell and charges below it).
 * @param {string} text  Plain text.
 * @param {object} [ctx]
 * @returns {{ entries: { name: string, level: number|null, charges: number, raw: string }[], dc: number|null,
 *   start: number, end: number }|null}  `start` / `end`: the intro and the list in `text`.
 */
export function recognizeCastList(text, ctx = {}) {
  const source = String(text ?? "");
  let intro = null;
  for ( const [re, lang] of [[LIST_INTRO_EN, "en"], [LIST_INTRO_FR, "fr"]] ) {
    if ( hasLang(ctx, lang) ) intro ??= source.match(re);
  }
  if ( !intro ) return null;
  const entries = [];
  const listStart = intro.index + intro[0].length;
  let lineEnd = source.indexOf("\n", listStart);
  if ( lineEnd < 0 ) lineEnd = source.length;
  const inline = source.slice(listStart, lineEnd);
  for ( const match of inline.matchAll(LIST_ENTRY) ) {
    const name = match[1].trim().replace(/^(?:and|or|et|ou)\s+/iu, "").replace(/^(?:(?:the|le|la|les)\s+|l')/iu, "");
    const level = match[2].match(LIST_LEVEL);
    if ( name ) entries.push({ name: titleCase(name), level: level ? Number(level[1] ?? level[2]) : null,
      charges: Number(match[3]), raw: match[0].trim() });
  }
  let end = lineEnd;
  if ( !entries.length ) {
    // A table: one "spell  charges" row per line below the intro
    let position = lineEnd + 1;
    while ( position < source.length ) {
      let next = source.indexOf("\n", position);
      if ( next < 0 ) next = source.length;
      const line = source.slice(position, next).trim();
      const row = line.match(LIST_ROW);
      if ( row ) {
        const level = row[1].match(LIST_LEVEL);
        entries.push({ name: titleCase(row[1].replace(/\s*\([^)]*\)\s*$/, "").trim()), level: level ? Number(level[1] ?? level[2]) : null,
          charges: Number(row[2]), raw: line });
        end = next;
      } else if ( !/\d/.test(line) && entries.length === 0 ) {
        end = next;   // the header row ("Spell Charges")
      } else break;
      position = next + 1;
    }
  }
  if ( !entries.length ) return null;
  const dc = (intro[0] + " " + inline).match(/\b(?:save\s+)?(?:DC|DD)\s*(\d+)(?!\s*(?:\+|plus\b))/i)?.[1];
  return { entries, dc: dc ? Number(dc) : null, start: intro.index, end };
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
 * Does the paragraph continue the previous property ("When you use this property, you also gain...", "Lorsque vous
 * utilisez cette propriété, ...")? Its facts then belong to the activity of the previous paragraph.
 * @param {string} text  Text of the paragraph.
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function refersToPrevious(text, ctx = {}) {
  const source = String(text ?? "").trim();
  return (hasLang(ctx, "en") && REFERS_EN.test(source)) || (hasLang(ctx, "fr") && REFERS_FR.test(source));
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
      const leading = activation && /^(?:(?:you|vous)\s+(?:can|may|pouvez)\s+|as\s+|en\s+tant\s+|using\s+)?$/iu
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
