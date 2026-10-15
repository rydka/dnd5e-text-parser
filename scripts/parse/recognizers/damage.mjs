import { hasLang, keyAllowed, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";

const NOT_ID = "(?<![\\w(+\\-/.,])";
const EN_PHRASE = "((?:[\\p{L}'-]+[\\s,]+){0,4}?)damage(?![\\p{L}])";
const FR_WORD = "(?:points?\\s+de\\s+)?d[ée]g[âa]ts?(?![\\p{L}])";

// Each pattern: [regex, kind, group of the formula, language]. Kind "fixed" needs a known damage type.
// "12 (2d6 + 5) piercing plus 10 (3d6) cold damage": the type precedes "plus" without the word "damage".
// ... "or 2 (1d4) Piercing if the swarm is Bloodied" and "5 (1d10) Poison at the start of each of its turns": the type
// precedes the condition of a second result or the timing of ongoing damage.
const EN_BARE_TYPE = "([\\p{L}-]+)(?=\\s*,?\\s*(?:plus|and)\\s+(?:an\\s+additional\\s+)?\\d"
  + "|\\s+(?:if|when|while|unless)(?![\\p{L}])|\\s+at\\s+the\\s+(?:start|end|beginning)(?![\\p{L}]))";
const BARE = new Set();
const bare = (regex, kind) => { BARE.add(regex); return [regex, kind]; };
const EN_PATTERNS = [
  bare(new RegExp(`(?:\\d+\\s+)?\\(\\s*([^()]*?\\d+\\s*d\\s*\\d+[^()]*?)\\s*\\)\\s*${EN_BARE_TYPE}`, "giu"), "dice"),
  bare(new RegExp(`${NOT_ID}(\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+${EN_BARE_TYPE}`, "giu"), "dice"),
  bare(new RegExp(`${NOT_ID}(\\d+)\\s+${EN_BARE_TYPE}`, "giu"), "fixed"),
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

// "subtracts 3 (1d6) from its damage rolls", "retranche 3 (1d6) à ses jets de dégâts": a penalty, never a damage part
const PENALTY_BEFORE = /(?:subtracts?|minus|reduc(?:es?|ed)\s+by|lowers?\s+by|loses?|retranch(?:e|ez|ent)|soustra(?:it|yez|ient)|r[ée]duits?\s+de|diminu[ée]s?\s+de|perd(?:ent)?)\s+(?:an?\s+|une?\s+)?$/iu;
const PENALTY_PHRASE = /^\s*(?:from|to|on)\s+(?:its|their|his|her|your|the)\b/iu;

// Versatile weapons: "if used with two hands", "si elle est maniée à deux mains", "tenue à deux mains", "à deux mains"
const EN_TWO_HANDS = String.raw`(?:if|when|while)\s+(?:used|wielded|held)\s+(?:with|in)\s+(?:both|two)\s+hands`;
const FR_TWO_HANDS_IF = String.raw`(?:si|lorsqu[e'’]|quand)\s+(?:elle|il|l['’]arme|l['’]objet)\s+est\s+(?:mani[ée]e?|tenue?|utilis[ée]e?|empoign[ée]e?)\s+[àa]\s+deux\s+mains`;
const FR_TWO_HANDS = String.raw`${FR_TWO_HANDS_IF}|(?:(?:mani[ée]e?|tenue?|utilis[ée]e?|empoign[ée]e?)\s+)?[àa]\s+deux\s+mains`;
// Before the clause, the French form needs its condition ("si elle est maniée à deux mains"): "sa hache à deux mains,
// infligeant 10 (2d6 + 3) dégâts" is a weapon name, not an alternative
const IGNORE_BEFORE = new RegExp(String.raw`(?:increases?\s+to|instead|${EN_TWO_HANDS}|[àa]\s+la\s+place|passe\s+[àa]|augmentent?\s+[àa]|${FR_TWO_HANDS_IF})[^.]*$`, "iu");
const IGNORE_AFTER = new RegExp(String.raw`^\s*(?:,\s*)?(?:${EN_TWO_HANDS}|${FR_TWO_HANDS})`, "iu");
const CHAIN_SEP = /^\s*(?:[,;]\s*)?(?:(?:plus|and|et|\+)\s+)?(?:(?:an\s+additional|additional|un\s+suppl[ée]ment\s+de)\s+)?$/iu;

// "of the weapon's type", "of the same type", "du type de l'arme", "du même type"
const WEAPON_TYPE = /^\s*(?:suppl[ée]mentaires?\s+|en\s+plus\s+)?(?:of\s+(?:the\s+)?(?:weapon'?s?|same|that|its|this)\s+type|(?:du|de\s+m[êe]me)\s+(?:m[êe]me\s+)?type|du\s+type\s+de\s+l'(?:arme|attaque)|de\s+m[êe]me\s+type)/iu;

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
  if ( known.length > 1 ) return { type: null, status: "ambiguous", phrase: phrase.trim(), choices: known };
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
  if ( unique.length > 1 ) return { type: null, status: "ambiguous", consumed, phrase, choices: unique };
  return { type: null, status: unknown ? "unknown" : "none", consumed: 0, phrase: unknown ?? "" };
}

/**
 * Damage clauses (C7): "9 (2d8 + 4) piercing damage", chained by "plus" / "and", fixed damage
 * ("Hit: 7 slashing damage") and the French forms. Clauses introduced by "increases to", "instead", "if used with
 * two hands" are ignored. `chains` groups consecutive clauses; `fact` lists every kept clause in text order and
 * `spans[i]` is the span of `fact[i]`. A penalty to damage rolls ("subtracts 3 (1d6) from its damage rolls") is
 * never a part: `Note.DamagePenalty` in `ambiguous`, and its passage in `covered` (read, but no fact).
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, keys }`.
 * @returns {{ fact: object[], chains: object[][], spans: object[], covered: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeDamage(text, ctx = {}) {
  const source = String(text ?? "");
  const languages = [hasLang(ctx, "en") && "en", hasLang(ctx, "fr") && "fr"].filter(Boolean);
  const found = [];
  const notes = [];
  const ambiguous = [];
  const weaponTyped = new Set();

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
      if ( BARE.has(regex) && typeInfo.status !== "ok" ) continue;
      // A penalty to damage rolls is kept apart: reported as ambiguous, never a damage part
      const lead = source.slice(Math.max(0, match.index - 40), match.index);
      const verb = lead.match(PENALTY_BEFORE);
      if ( verb || (lang === "en" && PENALTY_PHRASE.test(match[2] ?? "")) ) {
        const start = verb ? match.index - (lead.length - verb.index) : match.index;
        const tail = source.slice(end).match(/^\s*(?:rolls?|jets?)?/u)[0];
        found.push({ start: match.index, end: end + tail.length, part: null, typeInfo, penalty: { start } });
        continue;
      }
      // "extra 1d6 damage of the weapon's type": the type is the weapon's, not a damage part without a type
      if ( typeInfo.status !== "ok" && WEAPON_TYPE.test(source.slice(match.index + match[0].length, match.index + match[0].length + 60)) ) {
        if ( !weaponTyped.has(match.index) ) {
          weaponTyped.add(match.index);
          notes.push({ key: "dnd5e-text-parser.Note.DamageTypeFromWeapon", data: { raw: match[0] } });
        }
        continue;
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

  // Penalties: ambiguous (with the passage), and covered so the sentence is not handed to the fallback
  const covered = [];
  for ( const entry of kept.filter(entry => entry.penalty) ) {
    const raw = source.slice(entry.penalty.start, entry.end).trim();
    ambiguous.push({ key: "dnd5e-text-parser.Note.DamagePenalty", data: { raw } });
    covered.push({ kind: "damage", start: entry.penalty.start, end: entry.end, text: raw });
  }

  // Clauses to ignore
  const clauses = kept.filter(entry => {
    if ( entry.penalty ) return false;
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
    }
    const part = { ...entry.part, type, raw: source.slice(entry.start, entry.end).trim() };
    // "lightning or thunder damage": the dice are kept, the type is left empty and the choices are reported
    if ( typeInfo.status === "ambiguous" ) {
      const choices = (typeInfo.choices ?? []).filter(choice => keyAllowed(ctx.keys, "damageTypes", choice));
      part.typeChoices = choices;
      ambiguous.push({ key: "dnd5e-text-parser.Note.AmbiguousDamageType", data: { word: typeInfo.phrase, choices, raw: part.raw } });
    }
    parts.push(part);
    spans.push({ kind: "damage", start: entry.start, end: entry.end, text: part.raw });
    if ( previous && CHAIN_SEP.test(source.slice(previous.end, entry.start)) ) chains.at(-1).push(part);
    else chains.push([part]);
    previous = entry;
  }
  void ORIGIN;
  return { fact: parts, chains, spans, covered, ambiguous, notes };
}
