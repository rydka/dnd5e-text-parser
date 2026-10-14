import { hasLang, languagesOf, ORIGIN } from "./common.mjs";
import { parseFormula } from "./damage.mjs";
import { lookup, tableWords, fold } from "../lexicon/index.mjs";

const EN_CATEGORY = /\b(simple|martial)\s+(melee|ranged)\s+weapon\b/iu;
const FR_CATEGORY = /\barmes?\s+(courantes?|de guerre|martiales?)\s+(de corps [àa] corps|[àa] distance)/iu;
const EN_PROPERTIES = /\bproperties\s*:\s*([^.\n]*)/iu;
const FR_PROPERTIES = /\bpropri[ée]t[ée]s?\s*:\s*([^.\n]*)/iu;
const EN_VERSATILE = /\bversatile\s*\(\s*([^)]+?)\s*\)/iu;
const FR_VERSATILE = /\bpolyvalente?\s*\(\s*([^)]+?)\s*\)/iu;
const EN_BONUS = /\+(\d+)\s+bonus\s+to\s+(?:attack\s+(?:rolls?\s+)?and\s+damage|hit\s+and\s+damage)\s+rolls?/iu;
const FR_BONUS = /\bbonus\s+de\s+\+(\d+)\s+aux\s+jets\s+d'attaque\s+et\s+de\s+d[ée]g[âa]ts/iu;
const EN_MASTERY = /\bmastery\s*:\s*(\p{L}+)/iu;
const FR_MASTERY = /\bma[iî]trise\s*:\s*(\p{L}+)/iu;
const EXTRA_BEFORE = /\b(?:extra|additional|another|bonus|supplémentaires?|supplementaires?|en plus)\b/iu;
const EN_DAMAGE = /(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\s+([\p{L}]+)\s+damage\b/iu;
const FR_DAMAGE = /(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\s+d[ée]g[âa]ts\s+(?:de\s+|d')?([\p{L}]+)/iu;

const span = (kind, start, end, text) => ({ kind, start, end, text });

/** Base item id from a header detail ("longsword", "épée longue") or from the item name. */
function baseItemOf(detail, name, langs) {
  const direct = detail ? lookup("weaponIds", detail, langs) : null;
  if ( direct ) return direct;
  const folded = fold(name ?? "");
  for ( const word of tableWords("weaponIds", langs) ) {
    if ( new RegExp(`(?:^|[^\\p{L}])${fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(folded) ) {
      return lookup("weaponIds", word, langs);
    }
  }
  return null;
}

/** The sentence (without its end mark) around `index` in `text`. */
function sentenceAt(text, index) {
  const before = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index) + 1, -1);
  const start = before + 1;
  let end = text.slice(index).search(/\.(?:\s|$)|\n/);
  end = end < 0 ? text.length : index + end;
  return { start, end, text: text.slice(start, end) };
}

/**
 * Weapon details (C5, L6): category, base item, properties, base and versatile damage, magical bonus, mastery.
 * Applies when the header says "Weapon", when `ctx.itemType === "weapon"`, or when a "simple/martial melee/ranged
 * weapon" phrase is found.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, itemType, name }`.
 * @param {object|null} [meta]  `fact` of `recognizeItemMeta`.
 * @returns {{ fact: object|null, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeWeapon(text, ctx = {}, meta = null) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const spans = [];
  const none = { fact: null, spans, ambiguous: [], notes: [] };

  let category = null;
  let categoryMatch = null;
  for ( const [re, lang] of [[EN_CATEGORY, "en"], [FR_CATEGORY, "fr"]] ) {
    if ( !hasLang(ctx, lang) || categoryMatch ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    categoryMatch = match;
    const tier = /^(simple|courante)/i.test(match[1]) ? "simple" : "martial";
    category = tier + (/^(melee|de corps)/i.test(match[2]) ? "M" : "R");
    spans.push(span("weapon", match.index, match.index + match[0].length, match[0]));
  }
  if ( meta?.kind !== "weapon" && ctx.itemType !== "weapon" && !categoryMatch ) return none;

  const weapon = {
    category, baseItem: baseItemOf(meta?.kindDetail, ctx.name, langs), properties: [], base: null, versatile: null,
    magicalBonus: null, mastery: null, raw: categoryMatch?.[0] ?? meta?.raw ?? "", origin: ORIGIN
  };

  // Properties: "Properties: finesse, light, thrown (range 20/60)"; the parentheses stay for the range recognizer
  for ( const [re, lang] of [[EN_PROPERTIES, "en"], [FR_PROPERTIES, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const label = match[0].length - match[1].length;
    spans.push(span("weapon", match.index, match.index + label, match[0].slice(0, label)));
    for ( const item of match[1].matchAll(/([^,(]+?)(?=\s*(?:\(|,|$))/gu) ) {
      const head = item[1].trim();
      const key = head ? lookup("weaponProps", head, langs) : null;
      if ( !key ) continue;
      if ( !weapon.properties.includes(key) ) weapon.properties.push(key);
      const start = match.index + label + item.index + item[0].indexOf(head);
      spans.push(span("weapon", start, start + head.length, head));
    }
  }

  // Versatile: "versatile (1d10)"
  for ( const [re, lang] of [[EN_VERSATILE, "en"], [FR_VERSATILE, "fr"]] ) {
    if ( !hasLang(ctx, lang) || weapon.versatile ) continue;
    const match = source.match(re);
    if ( !match || !/\d+\s*d\s*\d+/.test(match[1]) ) continue;
    weapon.versatile = { ...parseFormula(match[1]), type: null, raw: match[0], origin: ORIGIN };
    if ( !weapon.properties.includes("ver") ) weapon.properties.push("ver");
    spans.push(span("weapon", match.index, match.index + match[0].length, match[0]));
  }

  // Base damage: a sentence that starts with the dice ("1d8 slashing damage, versatile (1d10).")
  for ( const [re, lang] of [[EN_DAMAGE, "en"], [FR_DAMAGE, "fr"]] ) {
    if ( !hasLang(ctx, lang) || weapon.base ) continue;
    for ( const match of source.matchAll(new RegExp(re.source, "giu")) ) {
      const sentence = sentenceAt(source, match.index);
      const lead = source.slice(sentence.start, match.index);
      if ( EXTRA_BEFORE.test(lead) || !/^\s*(?:(?:damage|d[ée]g[âa]ts)\s*:\s*)?$/iu.test(lead) ) continue;
      const type = lookup("damage", match[2], langs);
      weapon.base = { ...parseFormula(match[1]), type, raw: match[0], origin: ORIGIN };
      spans.push(span("weapon", match.index, match.index + match[0].length, match[0]));
      break;
    }
  }
  if ( weapon.versatile && weapon.base ) weapon.versatile.type = weapon.base.type;

  for ( const [re, lang] of [[EN_BONUS, "en"], [FR_BONUS, "fr"]] ) {
    if ( !hasLang(ctx, lang) || weapon.magicalBonus ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    weapon.magicalBonus = Number(match[1]);
    const sentence = sentenceAt(source, match.index);
    spans.push({ ...span("weapon", sentence.start, sentence.end, sentence.text), role: "bonus" });
  }
  if ( !weapon.magicalBonus ) {
    const fromName = String(ctx.name ?? "").match(/(?:^|\s)\+(\d)(?:\s|$)/);
    if ( fromName ) weapon.magicalBonus = Number(fromName[1]);
  }

  for ( const [re, lang] of [[EN_MASTERY, "en"], [FR_MASTERY, "fr"]] ) {
    if ( !hasLang(ctx, lang) || weapon.mastery ) continue;
    const match = source.match(re);
    if ( match ) {
      weapon.mastery = fold(match[1]);
      spans.push(span("weapon", match.index, match.index + match[0].length, match[0]));
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return { fact: weapon, spans, ambiguous: [], notes: [] };
}
