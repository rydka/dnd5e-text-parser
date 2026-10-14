import { hasLang, keyAllowed, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";

const NOT_ID = "(?<![\\w(+\\-/.,])";
const EN_PHRASE = "((?:[\\p{L}'-]+[\\s,]+){0,4}?)damage(?![\\p{L}])";
const FR_WORD = "(?:points?\\s+de\\s+)?d[ée]g[âa]ts?(?![\\p{L}])";

// Each pattern: [regex, kind, group of the formula, language]. Kind "fixed" needs a known damage type.
const EN_PATTERNS = [
  [new RegExp(`(?:\\d+\\s+)?\\(\\s*([^()]*?\\d+\\s*d\\s*\\d+[^()]*?)\\s*\\)\\s*${EN_PHRASE}`, "giu"), "dice"],
  [new RegExp(`${NOT_ID}(\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+${EN_PHRASE}`, "giu"), "dice"],
  [new RegExp(`${NOT_ID}(\\d+)\\s+${EN_PHRASE}`, "giu"), "fixed"]
];
const FR_PATTERNS = [
  [new RegExp(`(?:\\d+\\s+)?\\(\\s*([^()]*?\\d+\\s*d\\s*\\d+[^()]*?)\\s*\\)\\s*${FR_WORD}`, "giu"), "dice"],
  [new RegExp(`${NOT_ID}(\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?)\\s*${FR_WORD}`, "giu"), "dice"],
  [new RegExp(`${NOT_ID}(\\d+)\\s*${FR_WORD}`, "giu"), "fixed"]
];

const IGNORABLE = new Set([
  "magical", "additional", "extra", "bonus", "of", "the", "magic", "magique", "supplementaire", "supplementaires",
  "de", "d'", "du", "des", "magiques"
]);
const CONNECTORS = new Set(["or", "and", "ou", "et", ","]);
const STOP = new Set([
  "", "a", "au", "aux", "sur", "par", "si", "plus", "lorsque", "quand", "pendant", "en", "dans", "contre",
  "ainsi", "puis", "a", "le", "la", "les", "au", "ce", "cette", "chaque", "mais", "or", "dont", "qui", "que"
]);

const IGNORE_BEFORE = /(?:increases?\s+to|instead|if\s+(?:used|wielded)\s+with\s+two\s+hands|[àa]\s+la\s+place|passe\s+[àa]|augmentent?\s+[àa])[^.]*$/iu;
const IGNORE_AFTER = /^\s*(?:,\s*)?(?:if\s+(?:used|wielded)\s+with\s+two\s+hands|s'il\s+est\s+mani[ée]\s+[àa]\s+deux\s+mains|lorsqu'(?:il|elle)\s+est\s+utilis[ée]e?\s+[àa]\s+deux\s+mains)/iu;
const CHAIN_SEP = /^\s*(?:[,;]\s*)?(?:(?:plus|and|et|\+)\s+)?(?:(?:an\s+additional|additional|un\s+suppl[ée]ment\s+de)\s+)?$/iu;

const fold = word => String(word).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Dice formula to `{ number, denomination, bonus }` ("2d10 + 5", "1d8 + 1d6 + 3"). */
export function parseFormula(formula) {
  const dice = formula.match(/(\d+)\s*d\s*(\d+)/i);
  const rest = (formula.slice(0, dice.index) + " " + formula.slice(dice.index + dice[0].length)).trim();
  const terms = rest.match(/[+-]?\s*[^+-]+/g) ?? [];
  let bonus = "";
  for ( const term of terms ) {
    const sign = term.trim().startsWith("-") ? "-" : "+";
    const body = term.replace(/^[+-]\s*/, "").replace(/\s+/g, "").trim();
    if ( !body ) continue;
    bonus += bonus ? ` ${sign} ${body}` : (sign === "-" ? `-${body}` : body);
  }
  return { number: Number(dice[1]), denomination: Number(dice[2]), bonus };
}

/** Classify the words of an English type phrase. */
function classifyWords(words, languages) {
  const known = [];
  let unknown = false;
  for ( const raw of words ) {
    const word = raw.replace(/^[,.]+|[,.]+$/g, "");
    if ( !word || CONNECTORS.has(fold(word)) || IGNORABLE.has(fold(word)) ) continue;
    const key = lookup("damage", word, languages);
    if ( key ) known.push(key); else unknown = true;
  }
  return { known: [...new Set(known)], unknown };
}

/** Type from an English phrase. */
function typeFromEnglish(phrase, languages) {
  const words = phrase.trim().split(/[\s,]+/).filter(Boolean);
  if ( !words.length ) return { type: null, status: "none", phrase: "" };
  const { known, unknown } = classifyWords(words, languages);
  if ( known.length === 1 && !unknown ) return { type: known[0], status: "ok", phrase: phrase.trim() };
  if ( known.length > 1 ) return { type: null, status: "ambiguous", phrase: phrase.trim() };
  return { type: null, status: "unknown", phrase: phrase.trim() };
}

/**
 * Type from the words following the French word "dégâts": "de feu", "perforants", "supplémentaires de froid".
 * Returns the text consumed so the span can include it.
 */
function typeFromFrench(tail, languages) {
  const tokens = [...tail.matchAll(/\s*([\p{L}'-]+)/gu)];
  let consumed = 0;
  const known = [];
  let unknown = null;
  let lastEnd = 0;
  for ( let i = 0; i < tokens.length; i++ ) {
    const token = tokens[i];
    if ( token.index !== lastEnd ) break;
    let word = token[1];
    if ( /^d'/i.test(word) ) word = word.slice(2);
    const folded = fold(word);
    if ( ["de", "du", "des"].includes(folded) || !word ) { lastEnd = token.index + token[0].length; consumed = lastEnd; continue; }
    if ( IGNORABLE.has(folded) ) { lastEnd = token.index + token[0].length; consumed = lastEnd; continue; }
    const key = lookup("damage", word, languages);
    if ( key ) {
      known.push(key);
      lastEnd = token.index + token[0].length;
      consumed = lastEnd;
      // "de feu ou de froid" / "de feu et de froid"
      const next = tail.slice(lastEnd).match(/^\s*(?:,|et|ou)\s+(?:de\s+|d')?([\p{L}-]+)/iu);
      if ( next && lookup("damage", next[1], languages) ) {
        known.push(lookup("damage", next[1], languages));
        consumed = lastEnd + next[0].length;
      }
      break;
    }
    if ( !STOP.has(folded) ) unknown = word;
    break;
  }
  const unique = [...new Set(known)];
  const phrase = tail.slice(0, consumed).trim();
  if ( unique.length === 1 ) return { type: unique[0], status: "ok", consumed, phrase };
  if ( unique.length > 1 ) return { type: null, status: "ambiguous", consumed, phrase };
  return { type: null, status: unknown ? "unknown" : "none", consumed: 0, phrase: unknown ?? "" };
}

/**
 * Damage clauses (C7): "9 (2d8 + 4) piercing damage", chained by "plus" / "and", fixed damage
 * ("Hit: 7 slashing damage") and the French forms. Clauses introduced by "increases to", "instead", "if used with
 * two hands" are ignored. `chains` groups consecutive clauses; `fact` lists every kept clause in text order and
 * `spans[i]` is the span of `fact[i]`.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, keys }`.
 * @returns {{ fact: object[], chains: object[][], spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeDamage(text, ctx = {}) {
  const source = String(text ?? "");
  const languages = [hasLang(ctx, "en") && "en", hasLang(ctx, "fr") && "fr"].filter(Boolean);
  const found = [];
  const notes = [];
  const ambiguous = [];

  const patterns = [];
  if ( languages.includes("en") ) patterns.push(...EN_PATTERNS.map(entry => [...entry, "en"]));
  if ( languages.includes("fr") ) patterns.push(...FR_PATTERNS.map(entry => [...entry, "fr"]));

  for ( const [regex, kind, lang] of patterns ) {
    for ( const match of source.matchAll(regex) ) {
      let end = match.index + match[0].length;
      let typeInfo;
      if ( lang === "en" ) {
        typeInfo = typeFromEnglish(match[2] ?? "", languages);
      } else {
        typeInfo = typeFromFrench(source.slice(end), languages);
        end += typeInfo.consumed;
        // keep the text up to the end of the type phrase
      }
      if ( kind === "fixed" && typeInfo.status !== "ok" && typeInfo.status !== "ambiguous" ) continue;
      const formula = match[1];
      const part = kind === "dice"
        ? parseFormula(formula)
        : { number: null, denomination: null, bonus: String(Number(formula)) };
      found.push({ start: match.index, end, part, typeInfo });
    }
  }

  // Remove overlapping matches: first by position, then the longest
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for ( const entry of found ) {
    const last = kept.at(-1);
    if ( last && entry.start < last.end ) continue;
    kept.push(entry);
  }

  // Clauses to ignore
  const clauses = kept.filter(entry => {
    const sentenceStart = Math.max(source.lastIndexOf("\n", entry.start), source.lastIndexOf(". ", entry.start) + 1, 0);
    const before = source.slice(Math.max(sentenceStart, entry.start - 90), entry.start);
    const after = source.slice(entry.end, entry.end + 80);
    return !(IGNORE_BEFORE.test(before) || IGNORE_AFTER.test(after));
  });

  const chains = [];
  const parts = [];
  const spans = [];
  let previous = null;
  for ( const entry of clauses ) {
    const { typeInfo } = entry;
    let type = typeInfo.type;
    if ( type && !keyAllowed(ctx.keys, "damageTypes", type) ) {
      notes.push({ key: "dnd5e-text-parser.Note.UnknownDamageType", data: { word: typeInfo.phrase } });
      type = null;
    } else if ( typeInfo.status === "unknown" ) {
      notes.push({ key: "dnd5e-text-parser.Note.UnknownDamageType", data: { word: typeInfo.phrase } });
    } else if ( typeInfo.status === "ambiguous" ) {
      ambiguous.push({ key: "dnd5e-text-parser.Note.AmbiguousDamageType", data: { word: typeInfo.phrase } });
    }
    const part = { ...entry.part, type, raw: source.slice(entry.start, entry.end).trim() };
    parts.push(part);
    spans.push({ kind: "damage", start: entry.start, end: entry.end, text: part.raw });
    if ( previous && CHAIN_SEP.test(source.slice(previous.end, entry.start)) ) chains.at(-1).push(part);
    else chains.push([part]);
    previous = entry;
  }
  void ORIGIN;
  return { fact: parts, chains, spans, ambiguous, notes };
}
