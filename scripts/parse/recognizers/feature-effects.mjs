import { hasLang, languagesOf, isNegated, alternation, ORIGIN } from "./common.mjs";
import { lookup, damageKey } from "../lexicon/index.mjs";
import { splitSentences, parseNumber, toFeet } from "../text.mjs";
import { recognizeMagicEffects } from "./magic-effects.mjs";
import { hasPassiveMarker } from "./item-activity.mjs";

/**
 * Effects of a creature's passive feature (a trait without activation): what dnd5e 6 applies by itself through an
 * ActiveEffect transferred to the actor. English and French.
 * - The effects an item would give (`recognizeMagicEffects` with `subject: "self"`): bonus to AC, saves, checks,
 *   attack or damage, resistance / immunity / vulnerability, general advantage, ability score, speed.
 * - Damage reduction ("reduces all incoming bludgeoning, piercing, and slashing damage by 3", "réduit de 3 les
 *   dégâts contondants… qu'il subit"): `{ kind: "damageReduction", value: 3, scope: <damage type>|"all",
 *   bypasses?: ["mgc"] }` -> `system.traits.dm.amount.<type>` (one effect per type; "from nonmagical attacks"
 *   gives the `mgc` bypass of `system.traits.dm.bypasses`).
 * - Senses ("darkvision out to 120 feet", "vision dans le noir 36 m"): `{ kind: "sense", value: <feet>, scope }`.
 * - AC increase ("its AC increases by 2"): `{ kind: "ac", value: "+2" }`.
 * Nothing is invented (L3): an advantage limited to a cause ("against spells", "against being frightened", "checks
 * that rely on smell"), a conditional effect ("while in sunlight"), an aura on other creatures ("each creature
 * within 10 feet") or "reduced to 1 hit point instead" give no effect and a `Note.NotAutomated { raw }` remark
 * (the sentence), so a consumer can report it. Each effect is
 * `{ kind, value, scope, on?, bypasses?, raw, origin, when: "passive", duration: null, activity: null, sentence }`.
 */

const NOTE_NOT_AUTOMATED = "dnd5e-text-parser.Note.NotAutomated";
const SEPARATOR = String.raw`(?:,?\s+(?:and|or|et|ou)\s+|,\s*|\s+|\b)`;
const NOISE_EN = String.raw`(?:(?:all|any|the|its|incoming)\s+)*`;
const TAKES_EN = String.raw`(?:(?:that\s+)?(?:it|they|the\s+(?:[\p{L}'-]+\s+){0,2}?[\p{L}'-]+)\s+takes?\s+(?:from\s+(?:[\p{L}-]+\s+){1,4}?)?)?`;
const SUBIT_FR = String.raw`(?:(?:qu'(?:il|elle)\s+subit|subis(?:\s+par\s+(?:[\p{L}'-]+\s+){1,3}?)?)\s*(?:(?:provenant\s+)?d'attaques\s+non\s+magiques\s*)?)?`;
const ONE_HP = /(?:drops?|falls?|(?:is\s+|are\s+)?reduced)\s+to\s+1\s+hit\s+point\s+instead|(?:tombe|descend|est\s+r[ée]duite?)\s+[àa]\s+1\s+point\s+de\s+vie\s+[àa]\s+la\s+place/iu;
const AURA = new RegExp(String.raw`(?<![\p{L}])(?:within\s+\d+\s*(?:feet|foot|ft)|dans\s+un\s+rayon\s+de|` +
  // "à 9 m de lui", "à moins de 4,50 mètres de la banshee", "à 9 m ou moins"
  String.raw`[àa]\s+(?:moins\s+de\s+)?\d+(?:[.,]\d+)?\s*(?:m|m[eè]tres?)\s+(?:de\s+[\p{L}'-]+|d'[\p{L}-]+|du\s+[\p{L}'-]+|des\s+[\p{L}'-]+|ou\s+moins)|` +
  String.raw`other\s+creatures?|its\s+allies|ses\s+alli[ée]s|friendly\s+creatures?|allied\s+creatures?|` +
  String.raw`creatures?\s+of\s+(?:its|the\s+[\p{L}'-]+)\s+choice|cr[ée]atures?\s+de\s+son\s+choix)(?![\p{L}])`, "iu");
const CONDITIONAL = new RegExp(String.raw`(?<![\p{L}'])(?:while|when|whenever|if|unless|until|as\s+long\s+as|only|` +
  String.raw`that\s+rel(?:y|ies)\s+on|tant\s+qu(?:e|')|lorsqu(?:e|')|quand|si|jusqu'[àa]|sauf|seulement|uniquement|` +
  String.raw`qui\s+(?:reposent?|font\s+appel|fait\s+appel))(?:(?<=')|(?![\p{L}]))`, "iu");   // "tant qu'il": the elided form is followed by a letter
// "its AC increases by 2", "the AC of the guardian increases by 3", "La CA du gardien augmente de 3"
const AC_EN = /\b(?:AC|Armor\s+Class)\s+(?:of\s+(?:the\s+)?(?:[\p{L}'-]+\s+){1,3}?)?(?:increases|is\s+increased)\s+by\s+(\d+)/giu;
const AC_FR = /\bCA\s+(?:(?:du|de\s+la|de\s+l'|des)\s*(?:[\p{L}'-]+\s+){1,3}?)?(?:augmente|est\s+augment[ée]e)\s+de\s+(\d+)/giu;
const BYPASS = /non-?\s?magi/iu;
// Words of a sentence that states an effect (even one no recognizer read)
const EFFECT_WORDS = /\b(?:resistan|immun|vulnerab|advantage|disadvantage|bonus|r[ée]sistan|avantage|d[ée]savantage)/iu;

/** Regexes built from the lexicon for the enabled languages. */
function patterns(langs) {
  const en = langs.includes("en");
  const fr = langs.includes("fr");
  const result = {};
  if ( en ) {
    const types = String.raw`((?:(?:${alternation("damage", ["en"])})s?${SEPARATOR}){0,8}?)`;
    result.reduceEn = new RegExp(String.raw`\breduces?\s+${NOISE_EN}${types}damage\s+${TAKES_EN}by\s+(\d+)(?!\d)`, "giu");
    result.reducedEn = new RegExp(String.raw`(?<![\p{L}])${NOISE_EN}${types}damage\s+${TAKES_EN}is\s+reduced\s+by\s+(\d+)(?!\d)`, "giu");
    result.senseEn = new RegExp(String.raw`\b(${alternation("senses", ["en"])})\s+(?:(?:out\s+)?to\s+(?:a\s+(?:range|radius)\s+of\s+)?|` +
      String.raw`(?:with|within)\s+a\s+(?:range|radius)\s+of\s+|of\s+)?(\d+)\s*(?:feet|foot|ft\.?)`, "giu");
  }
  if ( fr ) {
    const types = String.raw`((?:(?:de\s+|d')?(?:${alternation("damage", ["fr"])})s?${SEPARATOR}){0,8}?)`;
    result.reduitFr = new RegExp(String.raw`\br[ée]duit\s+de\s+(\d+)\s+(?:tou(?:s|tes)\s+)?les\s+d[ée]g[âa]ts\s+${types}${SUBIT_FR}(?=[.;,]|$)`, "giu");
    result.reduitsFr = new RegExp(String.raw`\bles\s+d[ée]g[âa]ts\s+${types}${SUBIT_FR}sont\s+r[ée]duits\s+de\s+(\d+)(?!\d)`, "giu");
    result.senseFr = new RegExp(String.raw`\b(${alternation("senses", ["fr"])})\s+(?:(?:jusqu'[àa]|sur|d'une\s+port[ée]e\s+de|[àa]\s+port[ée]e\s+de|de|[àa])\s+)?` +
      String.raw`(\d+(?:[.,]\d+)?)\s*(m(?![\p{L}])|m[eè]tres?|pieds?)`, "giu");
  }
  return result;
}

/**
 * Damage type keys of a list ("bludgeoning, piercing, and slashing ", "de feu et d'acide "): `["all"]` for an
 * empty list (all damage), `null` when a word is not a damage type.
 * @param {string} list
 * @returns {string[]|null}
 */
function typesOf(list) {
  const words = list.split(/\s*(?:,|\b(?:and|or|et|ou)\b)\s*|\s+/u).map(word => word.replace(/^(?:de\s+|d')/iu, "").trim())
    .filter(Boolean);
  if ( !words.length ) return ["all"];
  const keys = words.map(word => damageKey(word));
  return keys.every(Boolean) ? [...new Set(keys)] : null;
}

/**
 * @param {string} text  Plain text of the feature.
 * @param {object} [ctx]  `{ languages, name }`.
 * @returns {{ fact: object[], spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeFeatureEffects(text, ctx = {}) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const re = patterns(langs);
  const sentences = splitSentences(source);
  const effects = [];
  const spans = [];
  const notes = [];
  const flagged = new Set();   // sentences reported as not automated

  const spanOf = sentence => ({ start: sentence.index, end: sentence.index + sentence.text.length });
  const notAutomated = sentence => {
    if ( flagged.has(sentence.index) ) return;
    flagged.add(sentence.index);
    notes.push({ key: NOTE_NOT_AUTOMATED, data: { raw: sentence.text.trim() } });
    spans.push({ kind: "effect", ...spanOf(sentence), text: sentence.text });
  };
  // A sentence that limits the effect to a cause, a condition or other creatures gives no effect
  const limited = sentence => ONE_HP.test(sentence.text) || AURA.test(sentence.text)
    || (CONDITIONAL.test(sentence.text) && !hasPassiveMarker(sentence.text, ctx));

  // The effects an item would give, read about the creature itself
  const magic = recognizeMagicEffects(source, { ...ctx, subject: "self" });
  const bySentence = new Map();
  for ( const effect of magic.fact ) {
    const sentence = sentences.find(entry => entry.index === effect.sentence.start) ?? sentences.find(entry => effect.sentence.start >= entry.index
      && effect.sentence.start < entry.index + entry.text.length);
    if ( !sentence ) continue;
    if ( !bySentence.has(sentence) ) bySentence.set(sentence, []);
    bySentence.get(sentence).push(effect);
  }
  for ( const [sentence, list] of bySentence ) {
    if ( list.some(effect => effect.against) || limited(sentence) ) { notAutomated(sentence); continue; }
    effects.push(...list);
    spans.push({ kind: "effect", ...spanOf(sentence), text: sentence.text });
  }

  for ( const sentence of sentences ) {
    if ( flagged.has(sentence.index) ) continue;
    const s = sentence.text;
    const before = effects.length;
    const add = effect => effects.push({ ...effect, origin: ORIGIN, when: "passive", duration: null, activity: null, sentence: spanOf(sentence) });
    const endOf = match => match.index + match[0].length;
    const skip = match => isNegated(s, match.index, endOf(match));
    let found = false;

    // Damage reduction
    const reductions = [[re.reduceEn, 1, 2], [re.reducedEn, 1, 2], [re.reduitFr, 2, 1], [re.reduitsFr, 1, 2]];
    for ( const [regex, listGroup, valueGroup] of reductions ) {
      if ( !regex ) continue;
      for ( const match of s.matchAll(regex) ) {
        if ( skip(match) ) continue;
        found = true;
        const types = typesOf(match[listGroup] ?? "");
        if ( !types ) { notAutomated(sentence); break; }
        const bypasses = BYPASS.test(match[0]) ? ["mgc"] : [];
        for ( const type of types ) add({ kind: "damageReduction", value: Number(match[valueGroup]), scope: type, bypasses, raw: s });
      }
      if ( flagged.has(sentence.index) ) break;
    }
    if ( flagged.has(sentence.index) ) continue;

    // Senses
    for ( const [regex, lang] of [[re.senseEn, "en"], [re.senseFr, "fr"]] ) {
      if ( !regex || !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(regex) ) {
        if ( skip(match) ) continue;
        const scope = lookup("senses", match[1], [lang]);
        const value = lang === "en" ? Number(match[2]) : toFeet(parseNumber(match[2]), /^m/i.test(match[3]) ? "m" : "ft");
        if ( scope && Number.isFinite(value) ) { found = true; add({ kind: "sense", value, scope, raw: s }); }
      }
    }

    // AC increase
    for ( const [regex, lang] of [[AC_EN, "en"], [AC_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(regex) ) {
        if ( skip(match) ) continue;
        found = true;
        add({ kind: "ac", value: `+${match[1]}`, scope: null, raw: s });
      }
    }

    if ( found && limited(sentence) ) {
      effects.splice(before);
      notAutomated(sentence);
      continue;
    }
    if ( effects.length > before ) spans.push({ kind: "effect", ...spanOf(sentence), text: s });
    // An effect stated for other creatures or under a condition that no recognizer read ("Each creature within
    // 10 feet ... has resistance", "While in sunlight ... has disadvantage on attack rolls") is not automated either
    else if ( ONE_HP.test(s) || (EFFECT_WORDS.test(s) && limited(sentence)) ) notAutomated(sentence);
  }

  return { fact: effects, spans, ambiguous: magic.ambiguous, notes };
}
