import { hasLang, languagesOf, ORIGIN } from "./common.mjs";
import { lookup, fold, damageKey, conditionKey, abilityKey } from "../lexicon/index.mjs";
import { splitSentences, parseNumber, toFeet } from "../text.mjs";

/**
 * Magic effects of an item (C7): bonuses to AC, attack, damage, saves and checks, resistance / immunity /
 * vulnerability, advantage / disadvantage, fixed ability score, speed. English and French.
 * Each effect is `{ kind, value, scope, on?, raw, origin, when: "passive", duration: null, activity: null }`;
 * `parseItem` decides `when`, `duration` and `activity` from the surrounding paragraph. `sentence` is the
 * `{ start, end }` span of the sentence the effect was read from.
 */

const STOP_EN = String.raw`(?=[.;]|\s+(?:while|when|whenever|as\s+long|if|against|made|and\s+(?:an?\s+)?\+\d+)\b|$)`;
const BONUS_EN = new RegExp(String.raw`\+(\d+)\s+bonus\s+to\s+(.+?)${STOP_EN}`, "giu");
const BONUS_FR = new RegExp(
  String.raw`\bbonus\s+de\s+\+(\d+)\s+(?:[àa]|aux?)\s+(.+?)(?=[.;]|\s+(?:tant\s+que|lorsque|quand|si|contre|avec)\b|\s+et\s+(?:d'un|un)\s+bonus|$)`,
  "giu"
);
const TRAIT_EN = new RegExp(
  String.raw`\b(resistance|immunity|vulnerability)\s+to\s+(.+?)(?=\s+(?:while|when|as\s+long|if|against|for|until|during)\b|[.;]|$)|\b(immune|resistant|vulnerable)\s+to\s+(.+?)(?=\s+(?:while|when|as\s+long|if|against|for|until|during)\b|[.;]|$)`,
  "giu"
);
const TRAIT_FR = new RegExp(
  String.raw`\b(r[ée]sistance|immunit[ée]|vuln[ée]rabilit[ée])\s+(?:aux?\s+d[ée]g[âa]ts\s+(?:de\s+|d')?|contre\s+l'[ée]tat\s+|contre\s+les\s+[ée]tats\s+|aux?\s+)(.+?)(?=\s+(?:tant\s+que|lorsque|quand|si|contre|pendant|jusqu)\b|[.;]|$)`,
  "giu"
);
// "immunisé contre la peur" (a creature immune to a condition)
const IMMUNE_FR = /\b(immunis[ée]e?s?)\s+(?:contre\s+|aux?\s+)(.+?)(?=\s+(?:tant\s+que|lorsque|quand|si|pendant|jusqu)\b|[.;]|$)/giu;
// "advantage on saving throws against being frightened" / "against poison" / "contre la peur"
const AGAINST_EN = /\badvantage\s+on\s+(?:all\s+)?saving\s+throws?\s+against\s+(.+?)(?=[.;]|\s+(?:while|when|as\s+long|if)\b|$)/giu;
const AGAINST_FR = /\bavantage\s+aux\s+jets\s+de\s+sauvegarde\s+contre\s+(.+?)(?=[.;]|\s+(?:tant\s+que|lorsque|quand|si)\b|$)/giu;
const AGAINST_SPLIT = /\s*(?:,|\band\s+against\b|\band\b|\bor\b|\bet\s+contre\b|\bet\b|\bou\b)\s*/iu;
const AGAINST_NOISE = /^(?:being|the|l'[ée]tat|les?|la|l'|d[ée]g[âa]ts\s+(?:de\s+|d')?)\s*|\s+(?:condition|damage)$/giu;
const ADVANTAGE_EN = /\b(advantage|disadvantage)\s+on\s+(?:all\s+)?(?:(\p{L}+)(?:\s*\(\s*([\p{L} ]+?)\s*\))?\s+)?(saving\s+throws?|(?:ability\s+)?checks?)\b(?!\s+(?:against|made|to\b))/giu;
const ADVANTAGE_FR = /\b(avantage|d[ée]savantage)\s+aux\s+(jets\s+de\s+sauvegarde|tests(?:\s+de\s+caract[ée]ristique)?)(?:\s+de\s+(\p{L}+)(?:\s*\(\s*([\p{L} ]+?)\s*\))?)?(?!\s+contre)/giu;
const SCORE_EN = /\bYour\s+(\p{L}+)(?:\s+score)?\s+(?:is|becomes|increases\s+to)\s+(\d+)/giu;
const SCORE_FR = /\bVotre\s+(?:(?:valeur|score)\s+(?:de\s+|d'))?(\p{L}+)\s+(?:passe|monte|est|devient|est\s+port[ée]e?)\s+(?:[àa]\s+|de\s+)?(\d+)/giu;
const SPEED_EN = /\bspeed\s+(?:increases|is\s+increased)\s+by\s+(\d+)\s*(?:feet|ft\.?)/giu;
const SPEED_FR = /\bvitesse(?:\s+de\s+d[ée]placement)?\s+augmente\s+de\s+(\d+(?:[.,]\d+)?)\s*m\b/giu;

const NOTE_UNKNOWN = "dnd5e-text-parser.Note.EffectUnknown";

/**
 * Attack / damage scope of a bonus phrase: null (all), "weapon", "spell" or a roll type.
 * @param {string} folded  Accent-folded lowercase phrase.
 * @returns {string|null}
 */
function rollScope(folded) {
  if ( /\bspell (?:attack|damage)|attaques? de sort|sorts?\b/.test(folded) ) return "spell";
  if ( /melee weapon|armes? de corps a corps/.test(folded) ) return "mwak";
  if ( /ranged weapon|armes? a distance/.test(folded) ) return "rwak";
  if ( /\bweapon|\barmes?\b/.test(folded) ) return "weapon";
  return null;
}

/** First ability named in a phrase, as a key. */
function abilityIn(phrase) {
  for ( const word of phrase.match(/\p{L}+/gu) ?? [] ) {
    const key = abilityKey(word);
    if ( key && fold(word).length > 3 ) return key;
  }
  return null;
}

function bonusEffects(object, value, raw, langs) {
  const folded = fold(object);
  if ( /spell save dc|dd de sauvegarde des sorts|dd des sorts/.test(folded) ) return [];
  const make = (kind, scope) => ({ kind, value, scope, raw });
  const result = [];
  if ( /\b(?:ac|ca)\b|armor class|classe d'armure/.test(folded) ) result.push(make("ac", null));
  if ( /saving throw|sauvegarde/.test(folded) ) result.push(make("save", abilityIn(object)));
  if ( /ability check|\bchecks?\b|\btests?\b|jets? de caracteristique/.test(folded) && !/saving throw|sauvegarde/.test(folded) ) {
    result.push(make("check", abilityIn(object)));
  }
  const attack = /attack|attaque/.test(folded);
  const damage = /damage|degats/.test(folded);
  if ( attack ) result.push(make("attack", rollScope(folded)));
  if ( damage ) result.push(make("damage", rollScope(folded)));
  void langs;
  return result;
}

function traitEffects(kind, object, raw, langs, lang) {
  const effects = [];
  const notes = [];
  if ( /non-?magi|nonmagi|from |provenant|d'attaques/.test(fold(object)) ) {
    notes.push({ key: NOTE_UNKNOWN, data: { kind, text: object } });
    return { effects, notes };
  }
  const parts = object.split(/\s*(?:,|\band\b|\bor\b|\bet\b|\bou\b)\s*/i).map(part => part.trim()).filter(Boolean);
  for ( const part of parts ) {
    const word = part.replace(/^(?:(?:immune|resistant|vulnerable)\s+to|immunis[ée]e?s?\s+(?:contre|[àa]))\s+/iu, "")
      .replace(/^(?:being|the|les?|l'|la|d'|de\s+|du\s+)\s*/iu, "")
      .replace(/\s+(?:damage|condition|conditions)$/i, "").replace(/^(?:d[ée]g[âa]ts\s+(?:de\s+|d')?)/iu, "").trim();
    const key = damageKey(word) ?? conditionKey(word);
    if ( key ) effects.push({ kind, value: null, scope: key, raw });
    else notes.push({ key: NOTE_UNKNOWN, data: { kind, text: part } });
  }
  void langs; void lang;
  return { effects, notes };
}

/**
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages }`.
 * @returns {{ fact: object[], spans: object[], ambiguous: object[], notes: object[] }}
 */
export function recognizeMagicEffects(text, ctx = {}) {
  const source = String(text ?? "");
  const langs = languagesOf(ctx);
  const effects = [];
  const spans = [];
  const ambiguous = [];

  for ( const sentence of splitSentences(source) ) {
    const s = sentence.text;
    const before = effects.length;
    const add = list => list.forEach(effect => effects.push({
      ...effect, on: effect.on, origin: ORIGIN, when: "passive", duration: null, activity: null,
      sentence: { start: sentence.index, end: sentence.index + s.length }
    }));
    const raw = s;

    for ( const [re, lang] of [[BONUS_EN, "en"], [BONUS_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) add(bonusEffects(match[2], `+${match[1]}`, raw, langs));
    }

    for ( const [re, lang] of [[TRAIT_EN, "en"], [TRAIT_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        const word = fold(match[1] ?? match[3]);
        const kind = word.startsWith("resist") ? "resistance" : word.startsWith("immun") ? "immunity" : "vulnerability";
        const result = traitEffects(kind, (match[2] ?? match[4]).trim(), raw, langs, lang);
        add(result.effects);
        ambiguous.push(...result.notes);
      }
    }

    for ( const [re, lang] of [[ADVANTAGE_EN, "en"], [ADVANTAGE_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        const kind = fold(match[1]).startsWith("dis") || fold(match[1]).startsWith("desa") ? "disadvantage" : "advantage";
        const first = lang === "en" ? match[2] : match[3];
        const second = lang === "en" ? match[3] : match[4];
        const kindWord = lang === "en" ? match[4] : match[2];
        const isSave = /sauvegarde|saving/i.test(kindWord);
        let on = isSave ? "save" : "check";
        let scope = null;
        if ( second ) {
          scope = lookup("skills", second, langs);
          if ( scope ) on = "skill";
        } else if ( first ) {
          scope = abilityKey(first) ?? null;
          if ( !scope ) { scope = lookup("skills", first, langs); if ( scope ) on = "skill"; }
        }
        if ( first && !scope ) continue;
        add([{ kind, value: null, scope, on, raw }]);
      }
    }

    for ( const [re, lang] of [[IMMUNE_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        const result = traitEffects("immunity", match[2].trim(), raw, langs, lang);
        add(result.effects);
        ambiguous.push(...result.notes);
      }
    }

    for ( const [re, lang] of [[AGAINST_EN, "en"], [AGAINST_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        for ( const part of match[1].split(AGAINST_SPLIT) ) {
          const word = part.replace(/^against\s+|^contre\s+/iu, "").replace(AGAINST_NOISE, "").trim();
          const against = conditionKey(word) ?? damageKey(word);
          if ( against ) add([{ kind: "advantage", value: null, scope: null, on: "save", against, raw }]);
        }
      }
    }

    for ( const [re, lang] of [[SCORE_EN, "en"], [SCORE_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        const scope = abilityKey(match[1]);
        if ( scope ) add([{ kind: "abilityScore", value: Number(match[2]), scope, raw }]);
      }
    }

    for ( const [re, lang] of [[SPEED_EN, "en"], [SPEED_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        const value = lang === "en" ? Number(match[1]) : toFeet(parseNumber(match[1]), "m");
        add([{ kind: "speed", value, scope: null, raw }]);
      }
    }

    if ( effects.length > before ) {
      spans.push({ kind: "effect", start: sentence.index, end: sentence.index + s.length, text: s });
    }
  }
  return { fact: effects, spans, ambiguous, notes: [] };
}
