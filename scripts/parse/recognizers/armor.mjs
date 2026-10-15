import { hasLang, languagesOf, isNegated, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";

const EN_AC = /\bAC\s+(\d+)(?:\s*\+\s*Dex(?:terity)?\s+modifier(?:\s*\(\s*max(?:imum)?\s*(?:of\s+)?(\d)\s*\))?)?/giu;
const FR_AC = /\bCA\s+(?:de\s+)?(\d+)(?:\s*\+\s*modificateur\s+de\s+Dex(?:t[ée]rit[ée])?(?:\s*\(\s*max(?:imum)?\s*(?:de\s+)?(\d)\s*\))?)?/giu;
// "against AC 24", "contre une CA de 20", "hits AC 15": the AC of a target, never the item's
const TARGET_AC_BEFORE = /(?:against|versus|vs\.?|hits?|contre|touche[rz]?)\s+(?:(?:an?|the|une?|la)\s+)?$/iu;
const EN_STRENGTH = /\bStrength\s+(\d+)\b/u;
const FR_STRENGTH = /\bForce\s+(\d+)\b/u;
const EN_STEALTH = /\bdisadvantage\s+on\s+(?:Dexterity\s*\(\s*)?Stealth(?:\s*\))?(?:\s+checks?)?/iu;
const FR_STEALTH = /\bd[ée]savantage\s+aux\s+tests\s+de\s+(?:Dext[ée]rit[ée]\s*\(\s*)?Discr[ée]tion(?:\s*\))?/iu;
// "a +2 bonus to Armor Class", "a bonus to AC of +2"; "bonus de +2 à la CA", "bonus à la CA de +2"
const EN_BONUS = [
  /\+(\d+)\s+bonus\s+to\s+(?:your\s+)?(?:AC|Armor\s+Class)\b/iu,
  /\bbonus\s+to\s+(?:your\s+)?(?:AC|Armor\s+Class)\s+(?:of\s+)?\+(\d+)/iu
];
const FR_BONUS = [
  /\bbonus\s+de\s+\+(\d+)\s+[àa]\s+(?:la\s+|votre\s+)?(?:CA|classe\s+d['’]armure)(?![\p{L}])/iu,
  /\bbonus\s+(?:[àa]|de)\s+(?:la\s+|votre\s+)?(?:CA|classe\s+d['’]armure)\s+de\s+\+(\d+)/iu
];
// "You have a bonus to AC while wearing this armor" (the number is in the name: "Breastplate +3")
const EN_BONUS_UNNUMBERED = /\bbonus\s+to\s+(?:your\s+)?(?:AC|Armor\s+Class)\b[^.]*\bthis\s+(?:armou?r|shield)\b/iu;
const FR_BONUS_UNNUMBERED = /\bbonus\s+[àa]\s+(?:la\s+|votre\s+)?(?:CA|classe\s+d['’]armure)(?![\p{L}])[^.]*\bcette\s+armure\b|\bbonus\s+[àa]\s+(?:la\s+|votre\s+)?(?:CA|classe\s+d['’]armure)(?![\p{L}])[^.]*\bce\s+bouclier\b/iu;
const NAME_BONUS = /(?:^|[\s(,])\+(\d)(?![\d\p{L}])/u;
const NAME_ARMOR = /\b(?:armou?r|shield|armure|bouclier)\b/iu;
// Base armor names (dnd5e `armorIds`) in English and French
const NAME_BASE = /\b(?:breastplate|chain\s+(?:mail|shirt)|half\s+plate|hide|(?:studded\s+)?leather|padded|plate|ring\s+mail|scale\s+mail|splint|cuirasse|(?:cotte|chemise)\s+de\s+mailles|demi-plate|peau|cuir(?:\s+clout[ée])?|matelass[ée]e?|harnois|broigne|[ée]cailles|clibanion)\b/iu;
const NAME_SHIELD = /\b(?:shield|bouclier)\b/iu;

const span = (kind, start, end, text) => ({ kind, start, end, text });

/** The sentence (without its end mark) around `index`. */
function sentenceAt(text, index) {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index) + 1, -1) + 1;
  let end = text.slice(index).search(/\.(?:\s|$)|\n/);
  end = end < 0 ? text.length : index + end;
  return span("armor", start, end, text.slice(start, end));
}

/**
 * Armor and shield details (C5, L6): type, base AC, Dexterity cap, Strength requirement, stealth disadvantage,
 * magical AC bonus. Applies when the header says "Armor", when `ctx.itemType` is `armor`, or when a base "AC 18" /
 * "CA 18" is found in an equipment item.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, itemType, name }`.
 * @param {object|null} [meta]  `fact` of `recognizeItemMeta`.
 * @returns {{ fact: object|null, spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeArmor(text, ctx = {}, meta = null) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const spans = [];
  const armor = {
    type: null, ac: null, dexCap: null, strength: null, stealthDisadvantage: false, magicalBonus: null,
    raw: meta?.kind === "armor" ? meta.raw : "", origin: ORIGIN
  };

  // A base AC belongs to the item only when nothing says it is something else (a wondrous item that lets you
  // "make an attack roll against AC 24" has no armor class)
  const mayHaveAc = !meta?.kind || meta.kind === "armor";
  let acMatch = null;
  for ( const [re, lang] of [[EN_AC, "en"], [FR_AC, "fr"]] ) {
    if ( !hasLang(ctx, lang) || acMatch || !mayHaveAc ) continue;
    for ( const match of source.matchAll(re) ) {
      if ( TARGET_AC_BEFORE.test(source.slice(Math.max(0, match.index - 20), match.index)) ) continue;
      acMatch = match;
      break;
    }
    if ( !acMatch ) continue;
    armor.ac = Number(acMatch[1]);
    if ( acMatch[2] ) armor.dexCap = Number(acMatch[2]);
    spans.push(span("armor", acMatch.index, acMatch.index + acMatch[0].length, acMatch[0]));
  }
  // An equipment named "Leather Armor +3" / "Shield +2" / "Breastplate +3" is armor even when its text says nothing
  // about it, or only "a bonus to AC while wearing this armor" without the number
  const nameBonus = String(ctx.name ?? "").match(NAME_BONUS);
  const unnumbered = (hasLang(ctx, "en") && EN_BONUS_UNNUMBERED.test(source))
    || (hasLang(ctx, "fr") && FR_BONUS_UNNUMBERED.test(source));
  const fromName = Boolean(nameBonus) && !meta?.kind
    && (NAME_ARMOR.test(ctx.name) || NAME_BASE.test(ctx.name) || unnumbered)
    && (!ctx.itemType || ["equipment", "armor"].includes(ctx.itemType));
  const isArmor = meta?.kind === "armor" || acMatch || fromName;
  if ( !isArmor ) return { fact: null, spans: [], ambiguous: [], notes: [] };

  if ( meta?.kindDetail ) armor.type = lookup("armor", meta.kindDetail, langs);
  else if ( fromName && NAME_SHIELD.test(ctx.name) ) armor.type = "shield";
  if ( !armor.raw && acMatch ) armor.raw = acMatch[0];

  for ( const [re, lang] of [[EN_STRENGTH, "en"], [FR_STRENGTH, "fr"]] ) {
    if ( !hasLang(ctx, lang) || armor.strength !== null ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    armor.strength = Number(match[1]);
    spans.push(span("armor", match.index, match.index + match[0].length, match[0]));
  }
  for ( const [re, lang] of [[EN_STEALTH, "en"], [FR_STEALTH, "fr"]] ) {
    if ( !hasLang(ctx, lang) || armor.stealthDisadvantage ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    // "the mithral version doesn't" / "no disadvantage on Stealth checks"
    const around = sentenceAt(source, match.index);
    if ( isNegated(around.text, match.index - around.start, match.index - around.start + match[0].length) ) continue;
    armor.stealthDisadvantage = true;
    spans.push({ ...span("armor", match.index, match.index + match[0].length, match[0]), role: "stealth" });
  }
  for ( const [list, lang] of [[EN_BONUS, "en"], [FR_BONUS, "fr"]] ) {
    if ( !hasLang(ctx, lang) ) continue;
    for ( const re of list ) {
      if ( armor.magicalBonus ) break;
      const match = source.match(re);
      if ( !match ) continue;
      armor.magicalBonus = Number(match[1]);
      spans.push({ ...sentenceAt(source, match.index), role: "bonus" });
    }
  }
  if ( !armor.magicalBonus && nameBonus ) armor.magicalBonus = Number(nameBonus[1]);

  spans.sort((a, b) => a.start - b.start);
  return { fact: armor, spans, ambiguous: [], notes: [] };
}
