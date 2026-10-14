import { EN } from "./en.mjs";
import { FR } from "./fr.mjs";

/**
 * Normalize a word for table lookup: lowercase, no accents, straight apostrophe, single spaces,
 * and trailing plural / feminine letters (`s`, `x`, `e`) removed from words longer than three letters.
 * @param {string} word
 * @returns {string}
 */
export function wordKey(word) {
  const key = String(word ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if ( key.length <= 3 ) return key;
  const stripped = key.replace(/[sxe]+$/, "");
  return stripped.length >= 3 ? stripped : key;
}

function build(source) {
  const tables = {};
  for ( const [name, entries] of Object.entries(source) ) {
    tables[name] = {};
    for ( const [word, value] of Object.entries(entries) ) tables[name][wordKey(word)] = value;
  }
  return tables;
}

const BY_LANG = { en: build(EN), fr: build(FR) };

/** Merged tables (English and French): `LEXICON[table][wordKey(word)] = key`. */
export const LEXICON = {};
for ( const lang of Object.keys(BY_LANG) ) {
  for ( const [name, entries] of Object.entries(BY_LANG[lang]) ) {
    LEXICON[name] = { ...(LEXICON[name] ?? {}), ...entries };
  }
}

/**
 * Look a word up in a table.
 * @param {string|object} table  Table name (`"damage"`, `"abilities"`...) or a `{ wordKey: value }` object.
 * @param {string} word
 * @param {("en"|"fr")[]} [languages]  Restrict to these languages (default: both).
 * @returns {string|number|null}
 */
export function lookup(table, word, languages) {
  const key = wordKey(word);
  if ( typeof table !== "string" ) return Object.hasOwn(table ?? {}, key) ? table[key] : null;
  const sources = languages?.length ? languages.map(lang => BY_LANG[lang]?.[table]) : [LEXICON[table]];
  for ( const source of sources ) {
    if ( source && Object.hasOwn(source, key) ) return source[key];
  }
  return null;
}

/**
 * Words of a table as written in the source tables, longest first.
 * @param {string} table
 * @param {("en"|"fr")[]} [languages]
 * @returns {string[]}
 */
export function tableWords(table, languages = ["en", "fr"]) {
  const words = new Set();
  const sources = { en: EN, fr: FR };
  for ( const lang of languages ) Object.keys(sources[lang]?.[table] ?? {}).forEach(word => words.add(word));
  return [...words].sort((a, b) => b.length - a.length);
}

/**
 * Lowercase, strip accents and normalize apostrophes. Length-preserving for precomposed characters,
 * so match indexes on the folded text are valid on the original text.
 * @param {string} text
 * @returns {string}
 */
export function fold(text) {
  return Array.from(String(text ?? ""), char => char.normalize("NFD")[0])
    .join("").toLowerCase().replace(/[‘’ʼ]/g, "'");
}

/**
 * Damage type key for a word such as "fire", "fire damage" or "dégâts de feu".
 * @param {string} word
 * @returns {string|null}
 */
export function damageKey(word) {
  const cleaned = fold(word).trim().replace(/\s+damage$/, "").replace(/^degats\s+(?:de\s+|d')?/, "");
  return lookup("damage", cleaned);
}

/**
 * Condition key for a word such as "charmed" or "à terre".
 * @param {string} word
 * @returns {string|null}
 */
export function conditionKey(word) {
  return lookup("conditions", word);
}

/**
 * Ability key for a word such as "Wisdom" or "Sagesse".
 * @param {string} word
 * @returns {string|null}
 */
export function abilityKey(word) {
  return lookup("abilities", word);
}

/**
 * Read a digit string or a number word (EN/FR, one to ten).
 * @param {string} word
 * @returns {number|null}
 */
export function toNumber(word) {
  const w = fold(word ?? "").trim();
  if ( /^\d+$/.test(w) ) return Number(w);
  return lookup("numbers", w);
}

/** Number alternation for regex sources (accent-folded text). */
export const NUMBER_RE = String.raw`\d+|one|two|three|four|five|six|seven|eight|nine|ten|une?|deux|trois|quatre|cinq|sept|huit|neuf|dix`;

/** Ability names alternation for regex sources (accent-folded text). */
export const ABILITY_RE = "strength|dexterity|constitution|intelligence|wisdom|charisma|force|dexterite|sagesse|charisme";
