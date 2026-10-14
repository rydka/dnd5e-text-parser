import { tableWords, lookup } from "../lexicon/index.mjs";
import { parseNumber } from "../text.mjs";

/** Languages enabled by the options / context (default: both). */
export function languagesOf(ctx) {
  const langs = (ctx?.languages ?? ["en", "fr"]).filter(lang => lang === "en" || lang === "fr");
  return langs.length ? langs : ["en", "fr"];
}

export const hasLang = (ctx, lang) => languagesOf(ctx).includes(lang);

const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Alternation of the words of a lexicon table, with and without accents, longest first. */
export function alternation(table, languages) {
  const words = new Set();
  for ( const word of tableWords(table, languages) ) {
    words.add(word);
    words.add(word.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  }
  return [...words].sort((a, b) => b.length - a.length).map(escape).join("|");
}

/** Does `keys[set]` accept `key`? Without a `keys` object, everything is accepted. */
export function keyAllowed(keys, set, key) {
  const valid = keys?.[set];
  return !valid || (typeof valid.has === "function" ? valid.has(key) : key in valid);
}

/** Integer from a number word or digits ("two", "deux", "3"). */
export function toCount(word) {
  const number = parseNumber(word);
  if ( number !== null ) return number;
  return lookup("numbers", word);
}

/** Span of a regex match, with the matched text. */
export function spanOf(kind, match, offset = 0) {
  const start = match.index + offset;
  return { kind, start, end: start + match[0].length, text: match[0] };
}

export const ORIGIN = "rules";
