import { hasLang, languagesOf, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";

const KINDS = new Set(["potion", "scroll", "wand", "rod", "ammo", "poison", "food"]);

const EN_CHARGES = /\b(?:has|have|with|holds?|contains?)\s+(\d+)\s+charges?\b/iu;
const FR_CHARGES = /\b(?:poss[èe]de|contient|dispose\s+de|a)\s+(\d+)\s+charges?\b/iu;
const FORMULA = String.raw`\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+`;
const EN_RECHARGE = new RegExp(String.raw`\bregains?\s+(?:(${FORMULA})|all)\s+(?:of\s+its\s+)?(?:expended\s+)?charges?\s+(?:daily\s+)?(?:at|each|every)\s+(dawn|dusk)\b`, "iu");
const FR_RECHARGE = new RegExp(String.raw`\br[ée]cup[èe]re\s+(?:(${FORMULA})|toutes?)\s+(?:les\s+)?charges?\s+(?:d[ée]pens[ée]es?\s+)?chaque\s+jour\s+(?:[àa]\s+l'|au\s+)(aube|cr[ée]puscule)`, "iu");
const EN_DESTROY = /\b(?:crumbles?|disintegrates?|dissolves?|turns?\s+to\s+dust|(?:is|are)\s+destroyed)\b/iu;
const FR_DESTROY = /\b(?:tombe\s+en\s+(?:poussi[èe]re|cendres)|s'effrite|se\s+d[ée]sint[èe]gre|se\s+dissout|est\s+d[ée]truit[es]?)/iu;
const EN_LAST = /\b(?:last\s+charge|roll\s+a\s+d20)/iu;
const FR_LAST = /\b(?:derni[èe]re\s+charge|lancez\s+un\s+d20)/iu;

const span = (kind, start, end, text) => ({ kind, start, end, text });

/** The sentence (without its end mark) around `index`. */
function sentenceAt(text, index) {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index) + 1, -1) + 1;
  let end = text.slice(index).search(/\.(?:\s|$)|\n/);
  end = end < 0 ? text.length : index + end;
  return span("consumable", start, end, text.slice(start, end));
}

/**
 * Consumable details (C5): type (potion, scroll, wand...), charges and their recovery, destruction once empty.
 * Applies when the header names a consumable kind or when `ctx.itemType === "consumable"`.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, itemType }`.
 * @param {object|null} [meta]  `fact` of `recognizeItemMeta`.
 * @returns {{ fact: object|null, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeConsumable(text, ctx = {}, meta = null) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const spans = [];
  const type = KINDS.has(meta?.kind) ? meta.kind : null;
  const isConsumable = Boolean(type) || ctx.itemType === "consumable";
  const consumable = { type, charges: null, destroyOnEmpty: false, raw: meta?.raw ?? "", origin: ORIGIN };

  let max = null;
  for ( const [re, lang] of [[EN_CHARGES, "en"], [FR_CHARGES, "fr"]] ) {
    if ( !hasLang(ctx, lang) || max !== null ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    max = Number(match[1]);
    spans.push(sentenceAt(source, match.index));
  }
  for ( const [re, lang] of [[EN_RECHARGE, "en"], [FR_RECHARGE, "fr"]] ) {
    if ( !hasLang(ctx, lang) || consumable.charges ) continue;
    const match = source.match(re);
    if ( !match || max === null ) continue;
    const period = lookup("periods", match[2], langs);
    if ( !period ) continue;
    consumable.charges = { max, period, formula: match[1] ? match[1].replace(/\s*([+-])\s*/g, " $1 ").replace(/\s*d\s*/i, "d") : null };
    spans.push(sentenceAt(source, match.index));
  }
  if ( max !== null && !consumable.charges ) consumable.charges = { max, period: null, formula: null };
  // Any other item ("The staff has 10 charges") reports its charges apart, as \`charges\`
  if ( !isConsumable ) {
    spans.sort((a, b) => a.start - b.start);
    return { fact: null, charges: consumable.charges, spans: consumable.charges ? spans : [], ambiguous: [], notes: [] };
  }

  for ( const [re, lang] of [[EN_DESTROY, "en"], [FR_DESTROY, "fr"]] ) {
    if ( !hasLang(ctx, lang) || consumable.destroyOnEmpty ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    consumable.destroyOnEmpty = true;
    spans.push(sentenceAt(source, match.index));
  }
  if ( consumable.destroyOnEmpty ) {
    for ( const [re, lang] of [[EN_LAST, "en"], [FR_LAST, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      const match = source.match(re);
      if ( match ) spans.push(sentenceAt(source, match.index));
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return { fact: consumable, spans, ambiguous: [], notes: [] };
}
