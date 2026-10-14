import { hasLang, spanOf, ORIGIN } from "./common.mjs";

const RECHARGE = /\(*\s*\brecharge\s+(\d)(?:\s*[-–]\s*(\d))?\s*\)*/giu;
const DAY_EN = /\b(\d+)\s*\/\s*day(?:\s+each)?(?!\s*:)/giu;
const DAY_FR = /\b(\d+)\s*\/\s*jour(?:\s+chacun)?(?!\s*:)/giu;
const REST_PER_EN = /\b(\d+)\s*\/\s*(short or long rest|short rest|long rest)\b/giu;
const REST_EN = /\brecharges?\s+after\s+a\s+(short\s+or\s+long|long|short)\s+rest\b/giu;
const REST_FR = /\b(?:se\s+)?recharge\s+apr[èe]s\s+un\s+repos\s+(court\s+ou\s+long|long|court)\b/giu;

const restPeriod = word => (/^long$/i.test(word.trim()) || /^long rest$/i.test(word.trim()) ? "lr" : "sr");

/**
 * Recharge and limited uses (C9): "Recharge 5-6", "3/Day", "Recharges after a Short or Long Rest",
 * and the French forms. `ctx.name` (which often carries "(Recharge 5-6)" or "(3/Day)") is searched too,
 * without spans.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, name }`.
 * @returns {{ fact: { uses: object|null, recharge: object|null }, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeUses(text, ctx = {}) {
  const source = String(text ?? "");
  const name = String(ctx.name ?? "");
  const spans = [];
  const uses = [];
  const recharges = [];
  const en = hasLang(ctx, "en");
  const fr = hasLang(ctx, "fr");

  const scan = (haystack, withSpans) => {
    const add = (kind, match, apply) => {
      apply(match);
      if ( withSpans ) spans.push(spanOf(kind, match));
    };
    for ( const match of haystack.matchAll(RECHARGE) ) {
      add("recharge", match, m => recharges.push({ min: Number(m[1]), raw: m[0].replace(/^\(+\s*|\s*\)+$/g, "").trim() }));
    }
    if ( en ) {
      for ( const match of haystack.matchAll(DAY_EN) ) {
        add("uses", match, m => uses.push({ max: Number(m[1]), period: "day", raw: m[0] }));
      }
      for ( const match of haystack.matchAll(REST_PER_EN) ) {
        add("uses", match, m => uses.push({ max: Number(m[1]), period: restPeriod(m[2]), raw: m[0] }));
      }
      for ( const match of haystack.matchAll(REST_EN) ) {
        add("uses", match, m => uses.push({ max: 1, period: restPeriod(m[1]), raw: m[0] }));
      }
    }
    if ( fr ) {
      for ( const match of haystack.matchAll(DAY_FR) ) {
        add("uses", match, m => uses.push({ max: Number(m[1]), period: "day", raw: m[0] }));
      }
      for ( const match of haystack.matchAll(REST_FR) ) {
        add("uses", match, m => uses.push({ max: 1, period: restPeriod(m[1]), raw: m[0] }));
      }
    }
  };
  scan(source, true);
  if ( name ) scan(name, false);

  const ambiguous = [];
  const pick = (list, label) => {
    const distinct = new Set(list.map(entry => JSON.stringify([entry.max ?? entry.min, entry.period])));
    if ( distinct.size > 1 ) ambiguous.push({ key: `dnd5e-text-parser.Note.${label}`, data: { raw: list.map(e => e.raw) } });
    return list[0] ?? null;
  };
  const use = pick(uses, "UsesConflict");
  const recharge = pick(recharges, "RechargeConflict");
  spans.sort((a, b) => a.start - b.start);
  return {
    fact: {
      uses: use ? { max: use.max, period: use.period, recoverFormula: null, raw: use.raw, origin: ORIGIN } : null,
      recharge: recharge ? { min: recharge.min, raw: recharge.raw, origin: ORIGIN } : null
    },
    spans, ambiguous, notes: []
  };
}
