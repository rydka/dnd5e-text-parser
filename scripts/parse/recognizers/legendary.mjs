import { fold, toNumber, NUMBER_RE } from "./actor-words.mjs";

const LEGACT_RE = new RegExp(
  `(?:(?:can|may) (?:take|use)|peut (?:effectuer|accomplir|realiser|entreprendre|utiliser|faire))`
  + ` (${NUMBER_RE}) (?:legendary actions?|actions? legendaires?)`, "g"
);
const LEGRES_RE = /(?:legendary resistances?|resistances? legendaires?)\s*\(\s*(\d+)\s*\/\s*(?:day|jour)/g;

/**
 * Legendary actions (C11) and legendary resistances (C12).
 * Spans are `{ kind, start, end, text }` on the input text. Conflicting numbers are reported in `ambiguous`
 * and the first value is kept.
 * @param {string} text  Plain text (already stripped of HTML).
 * @returns {{ fact: { legact: number|null, legres: number|null }, spans: object[], ambiguous: object[] }}
 */
export function recognizeLegendary(text) {
  const source = String(text ?? "");
  const folded = fold(source);
  const spans = [];
  const ambiguous = [];

  const find = (kind, pattern) => {
    const values = [];
    for ( const match of folded.matchAll(pattern) ) {
      const value = toNumber(match[1]);
      if ( value === null ) continue;
      values.push(value);
      spans.push({ kind, start: match.index, end: match.index + match[0].length,
        text: source.slice(match.index, match.index + match[0].length) });
    }
    const distinct = [...new Set(values)];
    if ( distinct.length > 1 ) {
      ambiguous.push({ key: "dnd5e-text-parser.Note.LegendaryConflict", data: { kind, values: distinct } });
    }
    return values.length ? values[0] : null;
  };

  return { fact: { legact: find("legact", LEGACT_RE), legres: find("legres", LEGRES_RE) }, spans, ambiguous };
}
