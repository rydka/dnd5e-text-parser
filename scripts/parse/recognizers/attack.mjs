import { hasLang, spanOf, ORIGIN } from "./common.mjs";

const EN_HEADER = /\b(melee|ranged)(?:\s+or\s+(melee|ranged))?\s+(?:(weapon|spell)\s+)?attack(?:\s+roll)?\b\s*:?/giu;
const EN_HEADER_BONUS = /^\s*(?:hit\s*:?\s*)?([+-]\d+)\b/iu;
const EN_TOHIT = /(?:([+-]\d+)\s+to\s+hit\b(?!\s+with\s+(?:spell|weapon)\s+attacks)|\battack\s+roll\s*:\s*([+-]\d+))/giu;

const MELEE_FR = "au corps [àa] corps";
const FR_HEADER = new RegExp(
  `\\b(?:jet\\s+d'attaque|attaque)\\s+(?:(d'arme|de sort)\\s+)?(${MELEE_FR}|[àa] distance)`
  + `(?:\\s+ou\\s+(${MELEE_FR}|[àa] distance))?(?:\\s+(?:avec|par)\\s+(une\\s+arme|un\\s+sort))?\\s*:?`, "giu");
const FR_HEADER_BONUS = /^\s*(?:(?:touch[ée]|hit)\s*:?\s*)?([+-]\d+)\b/iu;
const FR_TOHIT = /(?:([+-]\d+)\s+(?:au|pour)\s+toucher\b(?!\s+(?:avec|pour)\s+les\s+attaques)|\bjet\s+d'attaque\s*:\s*([+-]\d+))/giu;

const typeOf = word => (/^(melee|au corps)/i.test(word) ? "melee" : "ranged");
const classOf = word => {
  if ( !word ) return null;
  return /^(weapon|d'arme|une\s+arme)/i.test(word) ? "weapon" : "spell";
};

/**
 * Attack header and bonus (C5). English and French headers, "+N to hit" / "+N au toucher",
 * and the 2024 form "Attack Roll: +N". Several different bonuses make the attack ambiguous: no fact.
 * A header without a number ("Melee Attack Roll: Automatic hit") gives no attack fact, only a
 * `Note.AttackBonusMissing` note: no bonus is invented (L3) and the damage stands alone.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages }`.
 * @returns {{ fact: object|null, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeAttack(text, ctx = {}) {
  const source = String(text ?? "");
  const spans = [];
  const bonuses = [];
  const headers = [];
  const langs = [
    hasLang(ctx, "en") && { header: EN_HEADER, headerBonus: EN_HEADER_BONUS, tohit: EN_TOHIT },
    hasLang(ctx, "fr") && { header: FR_HEADER, headerBonus: FR_HEADER_BONUS, tohit: FR_TOHIT, fr: true }
  ].filter(Boolean);

  for ( const lang of langs ) {
    for ( const match of source.matchAll(lang.header) ) {
      const first = lang.fr ? match[2] : match[1];
      const classWord = lang.fr ? (match[1] ?? match[4]) : match[3];
      let end = match.index + match[0].length;
      const bonus = source.slice(end).match(lang.headerBonus);
      // A bare "melee attack" in running text ("AC against one melee attack") is not an attack header
      if ( !classWord && !match[0].includes(":") && !bonus ) continue;
      headers.push({ type: typeOf(first), classification: classOf(classWord), start: match.index, raw: match[0] });
      if ( bonus ) {
        const number = end + bonus[0].lastIndexOf(bonus[1]);
        bonuses.push({ value: Number(bonus[1]), start: number, end: number + bonus[1].length, raw: source.slice(match.index, number + bonus[1].length) });
        end += bonus[0].length;
      }
      spans.push({ kind: "attack", start: match.index, end, text: source.slice(match.index, end) });
    }
    for ( const match of source.matchAll(lang.tohit) ) {
      const value = match[1] ?? match[2];
      const start = match.index + match[0].lastIndexOf(value);
      const duplicate = bonuses.find(entry => entry.start === start && entry.value === Number(value));
      if ( !duplicate ) bonuses.push({ value: Number(value), start, end: start + value.length, raw: match[0] });
      spans.push(spanOf("attack", match));
    }
  }
  if ( !headers.length && !bonuses.length ) return { fact: null, spans: [], ambiguous: [], notes: [] };
  spans.sort((a, b) => a.start - b.start);

  const distinct = [...new Set(bonuses.map(entry => entry.value))];
  if ( distinct.length > 1 ) {
    return {
      fact: null, spans, notes: [],
      ambiguous: [{ key: "dnd5e-text-parser.Note.AttackBonuses", data: { values: distinct, raw: bonuses.map(entry => entry.raw) } }]
    };
  }
  headers.sort((a, b) => a.start - b.start);
  const header = headers[0] ?? null;
  const raw = [header?.raw, bonuses[0] && source.slice(bonuses[0].start, bonuses[0].end)].filter(Boolean).join(" ");
  // "Melee Attack Roll: Automatic hit": no number, so no attack (dnd5e would compute a bonus); the damage stands alone
  if ( !distinct.length ) {
    const phrase = source.slice(header.start).match(/^[^,.\n]{0,60}/)[0].trim();
    return { fact: null, spans, ambiguous: [], notes: [{ key: "dnd5e-text-parser.Note.AttackBonusMissing", data: { raw: phrase } }] };
  }
  return {
    fact: {
      type: header?.type ?? null,
      classification: header?.classification ?? null,
      bonus: distinct[0],
      raw: raw.trim(), origin: ORIGIN
    },
    spans, ambiguous: [], notes: []
  };
}
