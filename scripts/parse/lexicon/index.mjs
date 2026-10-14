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
