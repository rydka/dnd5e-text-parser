import { hasLang, toCount, spanOf, alternation, ORIGIN } from "./common.mjs";
import { parseNumber, toFeet } from "../text.mjs";

const NUM = "(\\d+(?:[.,]\\d+)?)";
const FT = "\\s*(?:ft\\.?|feet|foot)";
const M = "\\s*m(?:[eè]tres?)?(?![\\p{L}])";

const EN_REACH = new RegExp(`\\breach\\s+${NUM}${FT}`, "giu");
const EN_RANGE = new RegExp(`\\brange\\s+${NUM}(?:\\s*/\\s*${NUM})?${FT}`, "giu");
const FR_REACH = new RegExp(`\\ballonge\\s+(?:de\\s+)?${NUM}${M}`, "giu");
const FR_RANGE = new RegExp(`\\bportée\\s+(?:de\\s+)?${NUM}(?:\\s*/\\s*${NUM})?${M}`, "giu");

function targetPattern(langs) {
  const words = alternation("numbers", langs).split("|").filter(word => word !== "a" && word !== "an").join("|");
  const nouns = [langs.includes("en") && "target|creature", langs.includes("fr") && "cible|cr[ée]ature"]
    .filter(Boolean).join("|");
  return new RegExp(`\\b(${words}|\\d+)\\s+(${nouns})s?(?![\\p{L}])`, "giu");
}

/**
 * Reach, range and number of targets (C6). Distances are given in feet (meters converted).
 * "within X feet" is not a range and is ignored.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages }`.
 * @returns {{ fact: { range: object|null, target: object|null }, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeRangeTarget(text, ctx = {}) {
  const source = String(text ?? "");
  const spans = [];
  const en = hasLang(ctx, "en");
  const fr = hasLang(ctx, "fr");
  let reach = null;
  let value = null;
  let long = null;
  const raws = [];

  const take = (pattern, unit, kind) => {
    for ( const match of source.matchAll(pattern) ) {
      const convert = number => (number === undefined ? null : toFeet(parseNumber(number), unit));
      spans.push(spanOf(kind, match));
      if ( kind === "reach" ) {
        if ( reach === null ) { reach = convert(match[1]); raws.push(match[0]); }
      } else if ( value === null ) {
        value = convert(match[1]);
        long = convert(match[2]);
        raws.push(match[0]);
      }
    }
  };
  if ( en ) { take(EN_REACH, "ft", "reach"); take(EN_RANGE, "ft", "range"); }
  if ( fr ) { take(FR_REACH, "m", "reach"); take(FR_RANGE, "m", "range"); }

  let target = null;
  const found = source.matchAll(targetPattern([en && "en", fr && "fr"].filter(Boolean))).next().value;
  if ( found ) {
    const count = toCount(found[1]);
    // "a creature" / "une créature" is an article, not a count, unless it follows a comma ("range 30 ft., une créature") or targets a saving throw
    const article = /^(?:un|une|a|an)$/iu.test(found[1]);
    const afterComma = /,\s*$/.test(source.slice(0, found.index));
    const inSave = /saving throw|jet de sauvegarde/iu.test(source.slice(found.index).split(/[.!?](?:\s|$)/u)[0]);
    if ( count && (!article || afterComma || inSave) ) {
      spans.push(spanOf("target", found));
      target = {
        count, type: /^(creature|cr[ée]ature)/i.test(found[2]) ? "creature" : "",
        raw: found[0], origin: ORIGIN
      };
    }
  }

  const range = (reach !== null || value !== null)
    ? { reach, value, long, raw: raws.join(", "), origin: ORIGIN } : null;
  spans.sort((a, b) => a.start - b.start);
  return { fact: { range, target }, spans, ambiguous: [], notes: [] };
}
