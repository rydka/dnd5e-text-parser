import { hasLang, alternation, spanOf, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";
import { parseNumber, toFeet } from "../text.mjs";

const HALF_EN = /half\s+as\s+much|half\s+(?:of\s+)?(?:that|the|this)\s+damage|half\s+damage/iu;
// French distance with its unit (metres or feet); named groups let a pattern hold several distances
const dist = n => `(?<n${n}>\\d+(?:[.,]\\d+)?)\\s*(?<u${n}>m(?:[eè]tres?)?|pieds?|pi|ft)(?![\\p{L}])`;
const frFeet = (number, unit) => toFeet(parseNumber(number), /^m/i.test(unit ?? "m") ? "m" : "ft");
const HALF_FR = /(?:la\s+)?moiti[ée](?:\s+(?:de|des)\s+(?:ces\s+)?d[ée]g[âa]ts|\s+en\s+cas\s+de)|moiti[ée]\s+moins\s+de\s+d[ée]g[âa]ts|demi-d[ée]g[âa]ts/iu;
const FT = "(?:foot|feet|ft\\.?)";

function savePatterns(langs) {
  const abil = alternation("abilities", langs);
  const patterns = [];
  if ( langs.includes("en") ) {
    patterns.push([new RegExp(`\\bDC\\s*(\\d+)\\s*(${abil})\\s*(?:saving\\s+throws?|saves?)(?![\\p{L}])`, "giu"), 2, 1]);
    patterns.push([new RegExp(`\\b(${abil})\\s*(?:saving\\s+throws?|saves?)\\s*[:,(]?\\s*DC\\s*(\\d+)`, "giu"), 1, 2]);
  }
  if ( langs.includes("fr") ) {
    patterns.push([new RegExp(
      `\\bjets?\\s+de\\s+sauvegarde\\s+(?:de\\s+|d')\\s*(${abil})(?![\\p{L}])\\s*[(,:]?\\s*DD\\s*(\\d+)`, "giu"), 1, 2]);
    patterns.push([new RegExp(
      `\\bDD\\s*(\\d+)\\s*[,:;(]?\\s*(?:un\\s+)?jets?\\s+de\\s+sauvegarde\\s+(?:de\\s+|d')\\s*(${abil})(?![\\p{L}])`,
      "giu"), 2, 1]);
  }
  return patterns;
}

function templatePatterns(langs) {
  const patterns = [];
  if ( langs.includes("en") ) {
    patterns.push({ mode: "en-shape", re: new RegExp(
      `\\b(\\d+)\\s*-?\\s*${FT}[-\\s]*(?:(radius)[-\\s]*)?(?:long[-\\s]*)?(cone|sphere|line|cube|cylinder)(?![\\p{L}])`,
      "giu") });
    patterns.push({ mode: "en-line", re: new RegExp(
      `\\b(\\d+)\\s*${FT}\\s+long\\s+and\\s+(\\d+)\\s*${FT}\\s+wide`, "giu") });
    patterns.push({ mode: "en-radius", re: new RegExp(`\\b(\\d+)\\s*-?\\s*${FT}[-\\s]*radius(?![\\p{L}])`, "giu") });
    // "60-foot-long, 5-foot-wide Line" and "5-foot-wide, 60-foot-long Line"
    patterns.push({ mode: "en-line", re: new RegExp(
      `\\b(\\d+)[-\\s]*${FT}[-\\s]*long\\s*,?\\s*(?:and\\s+)?(\\d+)[-\\s]*${FT}[-\\s]*wide[-\\s]+line(?![\\p{L}])`, "giu") });
    patterns.push({ mode: "en-line-wide", re: new RegExp(
      `\\b(\\d+)[-\\s]*${FT}[-\\s]*wide\\s*,?\\s*(?:and\\s+)?(\\d+)[-\\s]*${FT}[-\\s]*long[-\\s]+line(?![\\p{L}])`, "giu") });
  }
  if ( langs.includes("fr") ) {
    // "un cône de 4,50 m", "un cône de flammes de 4,50 m", "une ligne de 18 m de long", distances in m or feet
    const lead = "(?:\\bligne\\s+(?:de\\s+)?)?";
    patterns.push({ mode: "fr-line", re: new RegExp(`\\bligne\\s+de\\s+${dist(1)}\\s+sur\\s+${dist(2)}`, "giu") });
    patterns.push({ mode: "fr-line", re: new RegExp(
      `${lead}${dist(1)}\\s+de\\s+long(?:ueur)?\\s*,?\\s*(?:et\\s+)?${dist(2)}\\s+de\\s+large(?:ur)?`, "giu") });
    patterns.push({ mode: "fr-line-wide", re: new RegExp(
      `${lead}${dist(1)}\\s+de\\s+large(?:ur)?\\s*,?\\s*(?:et\\s+)?${dist(2)}\\s+de\\s+long(?:ueur)?`, "giu") });
    patterns.push({ mode: "fr-shape", re: new RegExp(
      `\\b(c[ôo]ne|sph[èe]re|ligne|cube|cylindre)s?(?:\\s+(?:de\\s+|d')?[\\p{L}'-]+){0,3}?\\s+(?:de\\s+)?${dist(1)}` +
      "(?:\\s+de\\s+(?:rayon|c[ôo]t[ée]|haut(?:eur)?|long(?:ueur)?))?", "giu") });
    patterns.push({ mode: "fr-radius", re: new RegExp(`\\brayon\\s+de\\s+${dist(1)}`, "giu") });
  }
  return patterns;
}

const SHAPES = { cone: "cone", cône: "cone", sphere: "sphere", sphère: "sphere", ligne: "line", line: "line",
  cube: "cube", cylinder: "cylinder", cylindre: "cylinder" };
const shapeKey = word => SHAPES[word.toLowerCase()] ?? lookup("zones", word);

/**
 * Saving throw (DD / DC, ability, half damage on success) and area template (C8).
 * Several different saves make the save ambiguous: no `save` fact. `save.damage` is left empty
 * (the plan assigns it). The first span of kind "save" is the save itself.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages }`.
 * @returns {{ fact: { save: object|null, template: object|null }, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeSaveArea(text, ctx = {}) {
  const source = String(text ?? "");
  const langs = [hasLang(ctx, "en") && "en", hasLang(ctx, "fr") && "fr"].filter(Boolean);
  const spans = [];
  const ambiguous = [];
  const saves = [];

  for ( const [regex, abilityGroup, dcGroup] of savePatterns(langs) ) {
    for ( const match of source.matchAll(regex) ) {
      const ability = lookup("abilities", match[abilityGroup], langs);
      if ( !ability ) continue;
      saves.push({ ability, dc: Number(match[dcGroup]), start: match.index, raw: match[0] });
      spans.push(spanOf("save", match));
    }
  }
  let save = null;
  if ( saves.length ) {
    saves.sort((a, b) => a.start - b.start);
    const distinct = new Set(saves.map(entry => `${entry.ability}:${entry.dc}`));
    if ( distinct.size > 1 ) {
      ambiguous.push({
        key: "dnd5e-text-parser.Note.SaveAbilities",
        data: { raw: saves.map(entry => entry.raw), values: [...distinct].map(value => {
          const [ability, dc] = value.split(":");
          return { ability, dc: Number(dc) };
        }) }
      });
    } else {
      const tail = source.slice(saves[0].start);
      const halfRe = [langs.includes("en") && HALF_EN, langs.includes("fr") && HALF_FR]
        .filter(Boolean).find(re => re.test(tail));
      save = { ability: saves[0].ability, dc: saves[0].dc, onSave: halfRe ? "half" : "none", damage: [],
        raw: saves[0].raw, origin: ORIGIN };
      const halfMatch = halfRe && tail.match(halfRe);
      if ( halfMatch ) {
        const start = saves[0].start + halfMatch.index;
        spans.push({ kind: "half", start, end: start + halfMatch[0].length, text: halfMatch[0] });
      }
    }
  }

  let template = null;
  const candidates = [];
  for ( const { re, mode } of templatePatterns(langs) ) {
    for ( const match of source.matchAll(re) ) candidates.push({ match, mode });
  }
  candidates.sort((a, b) => a.match.index - b.match.index);
  const taken = [];
  for ( const { match: m, mode } of candidates ) {
    const end = m.index + m[0].length;
    if ( taken.some(range => m.index < range.end && end > range.start) ) continue;
    taken.push({ start: m.index, end });
    if ( template ) continue;
    let type = null;
    let size = null;
    let width = null;
    switch ( mode ) {
      case "en-shape": type = shapeKey(m[3]); size = Number(m[1]); break;
      case "en-line": type = "line"; size = Number(m[1]); width = Number(m[2]); break;
      case "en-radius": type = "radius"; size = Number(m[1]); break;
      case "en-line-wide": type = "line"; size = Number(m[2]); width = Number(m[1]); break;
      case "fr-shape": type = shapeKey(m[1]); size = frFeet(m.groups.n1, m.groups.u1); break;
      case "fr-line": type = "line"; size = frFeet(m.groups.n1, m.groups.u1); width = frFeet(m.groups.n2, m.groups.u2); break;
      case "fr-line-wide": type = "line"; size = frFeet(m.groups.n2, m.groups.u2); width = frFeet(m.groups.n1, m.groups.u1); break;
      case "fr-radius": type = "radius"; size = frFeet(m.groups.n1, m.groups.u1); break;
    }
    if ( !type ) continue;
    let raw = m[0];
    let height = null;
    if ( type === "line" && width === null ) {
      const en = source.match(/(\d+)[-\s]*(?:foot|feet|ft\.?)[-\s]*wide/i);
      const fr = source.match(new RegExp(`${dist(1)}\\s+de\\s+large(?:ur)?`, "iu"));
      if ( en ) width = Number(en[1]);
      else if ( fr ) width = frFeet(fr.groups.n1, fr.groups.u1);
      const found = en ?? fr;
      if ( found ) {
        raw = `${raw} ${found[0]}`;
        spans.push({ kind: "template", start: found.index, end: found.index + found[0].length, text: found[0] });
      }
    }
    if ( type === "cylinder" ) {
      const high = source.match(/(\d+)[-\s]*(?:foot|feet|ft\.?)[-\s]*(?:high|tall)/i);
      if ( high ) height = Number(high[1]);
    }
    template = { type, size, width, height, raw, origin: ORIGIN };
    spans.push(spanOf("template", m));
  }
  spans.sort((a, b) => a.start - b.start);
  return { fact: { save, template }, spans, ambiguous, notes: [] };
}
