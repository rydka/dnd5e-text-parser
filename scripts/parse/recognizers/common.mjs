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

const NEGATION = String.raw`(?:no|not|never|nor|without|doesn't|does\s+not|don't|do\s+not|isn't|is\s+not|aren't|are\s+not|can't|cannot|won't|will\s+not|ne|n'|ni|sans|aucune?|jamais|pas)`;
const NEG_BEFORE = new RegExp(String.raw`(?<![\p{L}'])${NEGATION}(?![\p{L}])[^.;:,!?]{0,40}$`, "iu");
const NEG_ANYWHERE = new RegExp(String.raw`(?<![\p{L}'])${NEGATION}(?![\p{L}'])`, "iu");
const HYPOTHETICAL = /\b(?:normally|usually|would|otherwise|normalement|habituellement|en\s+temps\s+normal)\b/iu;

/**
 * Is the fact read at `[start, end)` of the sentence negated ("doesn't have disadvantage on Stealth checks",
 * "n'impose pas de désavantage")? A negation just before it, or a negation after a "normally imposes ..." clause
 * ("if the armor normally imposes disadvantage ... the mithral version doesn't").
 * @param {string} sentence
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
export function isNegated(sentence, start, end) {
  const before = sentence.slice(0, start);
  if ( NEG_BEFORE.test(before) ) return true;
  return HYPOTHETICAL.test(before) && NEG_ANYWHERE.test(sentence.slice(end));
}

const NOT_WEARER_VERB = /(?:ignor(?:e|es|ent)|bypass(?:es)?|overcomes?|contourne(?:nt)?)(?![\p{L}])[^.;:,]{0,25}$/iu;
const NOT_WEARER_SUBJECT = /(?<![\p{L}])(?:creatures?|targets?|enem(?:y|ies)|monsters?|foes?|opponents?|cr[ée]atures?|cibles?|ennemis?|adversaires?)(?![\p{L}])[^.;:]{0,40}$/iu;

/**
 * Does the text before `start` make the fact about a target or an enemy rather than the wearer
 * ("ignores Resistance to slashing damage", "A creature that is immune to this effect")?
 * @param {string} sentence
 * @param {number} start
 * @returns {boolean}
 */
export function isNotWearer(sentence, start) {
  const before = sentence.slice(0, start);
  return NOT_WEARER_VERB.test(before) || NOT_WEARER_SUBJECT.test(before);
}
