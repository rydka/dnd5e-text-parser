import { hasLang, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";

const WORDS = "action|bonus action|action bonus|reaction|r[ée]action|legendary actions?|actions? l[ée]gendaires?";
const HEADER_LINE = new RegExp(`^\\s*(${WORDS})\\s*(?:\\([^)]*\\))?\\s*[.:]?\\s*$`, "iu");
const HEADER_SMALL = new RegExp(`^\\s*(${WORDS})\\s*$`, "iu");
const SMALL = /<small[^>]*>\s*([^<]+?)\s*<\/small>/iu;
const COST_EN = /\bcosts?\s+(\d+)\s+actions?\b/iu;
const COST_FR = /\bco[ûu]te\s+(\d+)\s+actions?\b/iu;

/**
 * Action type and cost (C10): header word (`<small>Action</small>` in `ctx.html`, or a first line made of the
 * header word), and "Costs 2 Actions" / "Coûte 2 actions" in the text or in `ctx.name`.
 * A cost without a header means a legendary action.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, name, html }`.
 * @returns {{ fact: object|null, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeActivation(text, ctx = {}) {
  const source = String(text ?? "");
  const name = String(ctx.name ?? "");
  const spans = [];
  let type = null;
  let raw = "";

  const small = String(ctx.html ?? "").match(SMALL)?.[1].match(HEADER_SMALL)?.[1];
  const firstLine = source.split("\n")[0] ?? "";
  const line = firstLine.match(HEADER_LINE)?.[1];
  const headerWord = small ?? line;
  if ( headerWord ) {
    const key = lookup("activation", headerWord.trim());
    if ( key ) {
      type = key;
      raw = headerWord.trim();
      if ( line ) spans.push({ kind: "activation", start: 0, end: firstLine.length, text: firstLine });
    }
  }

  let cost = null;
  const costRes = [hasLang(ctx, "en") && COST_EN, hasLang(ctx, "fr") && COST_FR].filter(Boolean);
  for ( const [haystack, withSpan] of [[source, true], [name, false]] ) {
    for ( const re of costRes ) {
      const match = haystack.match(re);
      if ( !match ) continue;
      if ( withSpan ) spans.push({ kind: "activation", start: match.index, end: match.index + match[0].length, text: match[0] });
      if ( cost === null ) {
        cost = Number(match[1]);
        raw = [raw, match[0]].filter(Boolean).join(" ");
      }
    }
  }
  if ( cost !== null && !type ) type = "legendary";
  if ( !type ) return { fact: null, spans: [], ambiguous: [], notes: [] };
  if ( type === "legendary" && cost === null ) cost = 1;
  return { fact: { type, cost: type === "legendary" ? cost : (cost ?? null), raw, origin: ORIGIN }, spans, ambiguous: [], notes: [] };
}
