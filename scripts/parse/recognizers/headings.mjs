import { alternation } from "./common.mjs";
import { splitLines, splitSentences, nameKey } from "../text.mjs";

/**
 * Headings of an item description written as plain text (no bold lead-ins): the name of the item on its first
 * line, section titles ("Magic Properties", "Propriétés magiques") and the names of properties that open a
 * paragraph ("Refusal to Die. Once per long rest, ..."). They are titles, not rules: `parseItem` covers them (they
 * never go to `unrecognized`) and names the activity of a paragraph after its lead-in. English and French.
 */

const SECTION = /^(?:magic(?:al)?\s+properties|properties|description|curse|propri[ée]t[ée]s?\s+magiques?|propri[ée]t[ée]s|mal[ée]diction)\s*:?$/iu;
// Words a title never carries: pronouns, modals and verbs of a rule sentence
const RULE_WORD = /(?<![\p{L}'])(?:you|your|yours|it|its|they|can|can't|cannot|may|must|is|are|has|have|vous|votre|vos|il|elle|ils|elles|peut|pouvez|peuvent|doit|devez|est|sont|a|avez|ont)(?![\p{L}])/iu;
const PUNCTUATION_END = /[.!?:;]$/u;
const MAX_WORDS = 5;
const MAX_LENGTH = 40;
// What a rule states and flavor text does not: numbers, the reader, modals, game terms
const RULE_MARKER = new RegExp(String.raw`\d|(?<![\p{L}'])(?:you|your|yours|vous|votre|vos|can|can't|cannot|may|must|peut|peuvent|pouvez|` +
  String.raw`doit|devez|rolls?|jets?|bonus|advantage|disadvantage|avantage|d[ée]savantage|damage|d[ée]g[âa]ts|attacks?|attaques?|` +
  String.raw`actions?|r[ée]actions?|charges?|spells?|sorts?|DC|DD|hit\s+points?|points?\s+de\s+vie|saving\s+throws?|sauvegardes?|` +
  String.raw`resistan\p{L}*|r[ée]sistan\p{L}*|immun\p{L}*|creatures?|cr[ée]atures?|targets?|cibles?|turns?|tours?|rounds?|minutes?|` +
  String.raw`hours?|heures?|days?|jours?|rest|repos|conditions?|[ée]tats?|attune\p{L}*|harmonis\p{L}*|speed|vitesse|feet|ft|m[èe]tres?)(?![\p{L}])`, "iu");

/**
 * Is a line flavor text: a paragraph that states no rule (no number, no "you", no game term)? Called by
 * `parseItem` on the lines no recognizer covered.
 * @param {string} line
 * @returns {boolean}
 */
export function isFlavorLine(line) {
  return !RULE_MARKER.test(String(line ?? ""));
}

/**
 * Is the first line a meta line (a rarity, or a header such as "Wondrous item (ring), uncommon")?
 * @param {string} line
 * @param {("en"|"fr")[]} langs
 */
function isMetaLine(line, langs) {
  const rarity = new RegExp(`^(?:${alternation("rarity", langs)})(?![\\p{L}])`, "iu");
  const kind = new RegExp(`^(?:${alternation("itemKinds", langs)})(?![\\p{L}])`, "iu");
  return rarity.test(line) || kind.test(line) || /,\s*(?:requires\s+attunement|n[ée]cessite\s+un\s+lien)/iu.test(line);
}

/** Is a short sentence a title ("Refusal to Die.", "Le prix du sursis.")? */
function isTitle(sentence) {
  const body = sentence.replace(/\.$/u, "").trim();
  if ( !body || !sentence.endsWith(".") ) return false;
  if ( body.length > MAX_LENGTH || /\d/u.test(body) || /[.!?:;,]/u.test(body) ) return false;
  if ( body.split(/\s+/u).length > MAX_WORDS ) return false;
  return !RULE_WORD.test(body);
}

/**
 * @param {string} text  Plain text of the item.
 * @param {object} [ctx]  `{ name, languages }`.
 * @returns {{ spans: { kind: "heading", role: "name"|"section"|"property", start: number, end: number, text: string }[],
 *   leads: string[] }}  `leads`: the property names (without their period), to name activities.
 */
export function recognizeHeadings(text, ctx = {}) {
  const source = String(text ?? "");
  const langs = (ctx.languages ?? ["en", "fr"]).filter(lang => lang === "en" || lang === "fr");
  const lines = splitLines(source);
  const spans = [];
  const leads = [];
  const heading = (role, start, end) => spans.push({ kind: "heading", role, start, end, text: source.slice(start, end) });

  lines.forEach((line, index) => {
    const end = line.index + line.text.length;
    // The item name on the first line: equal to the name, or a short line without punctuation above a meta line
    if ( index === 0 ) {
      const sameName = ctx.name && nameKey(line.text) === nameKey(ctx.name);
      const aboveMeta = lines[1] && isMetaLine(lines[1].text, langs.length ? langs : ["en", "fr"]) && !PUNCTUATION_END.test(line.text)
        && line.text.split(/\s+/u).length <= 8;
      if ( sameName || aboveMeta ) { heading("name", line.index, end); return; }
    }
    if ( SECTION.test(line.text) ) { heading("section", line.index, end); return; }
    // A property name opening a paragraph of at least two sentences
    const sentences = splitSentences(line.text);
    if ( sentences.length < 2 || sentences[0].index !== 0 ) return;
    const first = sentences[0].text;
    if ( !isTitle(first) ) return;
    heading("property", line.index, line.index + first.length);
    leads.push(first.replace(/\.$/u, "").trim());
  });
  return { spans, leads };
}
