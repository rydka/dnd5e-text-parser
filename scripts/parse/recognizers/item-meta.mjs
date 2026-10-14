import { hasLang, languagesOf, alternation, ORIGIN } from "./common.mjs";
import { lookup } from "../lexicon/index.mjs";
import { parseNumber, toPounds } from "../text.mjs";

const EN_ATTUNEMENT = /\brequires?\s+attunement(?:\s+by\s+([^)\n.;,]+?))?(?=\s*[).;,]|\s*$)/imu;
const FR_ATTUNEMENT = /\b(?:n[ée]cessite|requiert)\s+un\s+lien(?:\s+d['’]harmonisation)?(?:\s+(?:avec|par)\s+([^)\n.;,]+?))?(?=\s*[).;,]|\s*$)/imu;
const EN_WEIGHT = /\b(?:weight|weighs)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(lbs?|pounds?|kg)\b\.?/iu;
const FR_WEIGHT = /\bpoids\s*:?\s*(\d+(?:[.,]\d+)?)\s*(kg|lbs?|livres?)\b\.?/iu;
const EN_PRICE = /\b(?:price|costs?|worth)\s*:?\s*(\d[\d,]*(?:\.\d+)?)\s*(cp|sp|ep|gp|pp)\b\.?/iu;
const FR_PRICE = /\b(?:prix|co[ûu]t|valeur)\s*:?\s*(\d[\d \u00a0\u202f]*(?:[.,]\d+)?)\s*(pc|pa|pe|po|pp)\b\.?/iu;
const MAGICAL_RARITIES = new Set(["uncommon", "rare", "veryRare", "legendary", "artifact"]);

/**
 * Header line (`Weapon (longsword), uncommon (requires attunement by a wizard)`), rarity, attunement and its
 * condition, weight, price and the item kind (C5). English and French.
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages }`.
 * @returns {{ fact: object, spans: object[], ambiguous: object[], notes: object[] }}
 *   `fact` = `{ kind, kindDetail, rarity, attunement, attunementCondition, weight, price, magical, raw }`
 *   (every field `null` / absent when not found). `kind` is one of weapon, armor, potion, scroll, wand, rod,
 *   staff, ring, wondrous, ammo, poison, food.
 */
export function recognizeItemMeta(text, ctx = {}) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const spans = [];
  const fact = {
    kind: null, kindDetail: null, rarity: null, attunement: null, attunementCondition: null,
    weight: null, price: null, magical: false, raw: "", origin: ORIGIN
  };
  const span = (kind, match) => spans.push({ kind, start: match.index, end: match.index + match[0].length, text: match[0] });

  const rarityWords = alternation("rarity", langs);
  const header = new RegExp(
    `^[ \\t]*([^,(\\n]{2,40}?)[ \\t]*(?:\\(([^)\\n]*)\\))?[ \\t]*,[ \\t]*(${rarityWords})(?![\\p{L}])(?:[ \\t]*\\(([^)\\n]*)\\))?`,
    "imu"
  );
  let found = source.match(header);
  // Away from the first line, only a known item kind makes a comma-separated phrase a header
  if ( found && found.index > 0 && !lookup("itemKinds", found[1], langs) ) found = null;
  if ( found ) {
    fact.kind = lookup("itemKinds", found[1], langs);
    fact.kindDetail = found[2]?.trim() || null;
    fact.rarity = lookup("rarity", found[3], langs);
    fact.raw = found[0].trim();
    span("meta", found);
  } else {
    // A rarity alone on a line ("Rare", "Rare (requires attunement)")
    const bare = source.match(new RegExp(`^[ \\t]*(${rarityWords})(?![\\p{L}])(?:[ \\t]*\\([^)\\n]*\\))?[ \\t]*$`, "imu"));
    if ( bare ) {
      fact.rarity = lookup("rarity", bare[1], langs);
      fact.raw = bare[0].trim();
      span("meta", bare);
    }
  }

  const attunement = [hasLang(ctx, "en") && EN_ATTUNEMENT, hasLang(ctx, "fr") && FR_ATTUNEMENT]
    .filter(Boolean).map(re => source.match(re)).find(Boolean);
  if ( attunement ) {
    fact.attunement = "required";
    if ( attunement[1] ) fact.attunementCondition = attunement[1].trim();
    const covered = spans.some(entry => attunement.index >= entry.start && attunement.index < entry.end);
    if ( !covered ) span("attunement", attunement);
  }

  for ( const [re, lang] of [[EN_WEIGHT, "en"], [FR_WEIGHT, "fr"]] ) {
    if ( !hasLang(ctx, lang) || fact.weight ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const value = parseNumber(match[1]);
    if ( value === null ) continue;
    fact.weight = { value: toPounds(value, /^kg/i.test(match[2]) ? "kg" : "lb"), units: "lb", raw: match[0].trim(), origin: ORIGIN };
    span("weight", match);
  }

  for ( const [re, lang] of [[EN_PRICE, "en"], [FR_PRICE, "fr"]] ) {
    if ( !hasLang(ctx, lang) || fact.price ) continue;
    const match = source.match(re);
    if ( !match ) continue;
    const digits = lang === "en" ? match[1].replace(/,/g, "") : match[1].replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
    const value = parseNumber(digits);
    const denomination = lookup("currency", match[2], langs);
    if ( value === null || !denomination ) continue;
    fact.price = { value, denomination, raw: match[0].trim(), origin: ORIGIN };
    span("price", match);
  }

  fact.magical = MAGICAL_RARITIES.has(fact.rarity);
  spans.sort((a, b) => a.start - b.start);
  return { fact, spans, ambiguous: [], notes: [] };
}
