import { hasLang, languagesOf, isNegated, isNotWearer, ORIGIN } from "./common.mjs";
import { lookup, fold, damageKey, conditionKey, abilityKey, ABILITY_RE } from "../lexicon/index.mjs";
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
const SCORE_EN = /\bYour\s+(\p{L}+)(?:\s+score)?\s+(?:is|becomes|changes\s+to|increases\s+to)\s+(\d+)/giu;
const SCORE_FR = /\bVotre\s+(?:(?:valeur|score)\s+(?:de\s+|d'))?(\p{L}+)\s+(?:passe|monte|est|devient|est\s+port[ée]e?)\s+(?:[àa]\s+|de\s+)?(\d+)/giu;
const SPEED_EN = /\bspeed\s+(?:increases|is\s+increased)\s+by\s+(\d+)\s*(?:feet|ft\.?)/giu;
const SPEED_FR = /\bvitesse(?:\s+de\s+d[ée]placement)?\s+augmente\s+de\s+(\d+(?:[.,]\d+)?)\s*m\b/giu;

const AGAINST_TAIL = /^\s*(?:against|contre)(?![\p{L}])/iu;
const THIS_EFFECT = /^(?:this|that|these|those|the\s+effect|it|its|ce|cet|cette)(?![\p{L}])/iu;
const BONUS_OF_EN = /\bbonus\s+to\s+(.+?)\s+of\s+\+(\d+)/giu;
const BONUS_OF_FR = /\bbonus\s+(?:aux?|[àa]\s+la|[àa]\s+l')\s*(.+?)\s+de\s+\+(\d+)/giu;
const MOVEMENT = { fly: "fly", vol: "fly", swim: "swim", nage: "swim", climb: "climb", escalade: "climb", burrow: "burrow", creusement: "burrow" };
const MOVEMENT_EN = /\b(fly|flying|swim|swimming|climb|climbing|burrow|burrowing)\s+speed\s+(?:of|equal\s+to)\s+(\d+)\s*(?:feet|ft\.?)/giu;
const MOVEMENT_FR = /\bvitesse\s+de\s+(vol|nage|escalade|creusement)\s+(?:de|[ée]gale?\s+[àa])\s+(\d+(?:[.,]\d+)?)\s*(m(?![\p{L}])|m[eè]tres?|pieds?)/giu;
const NOTE_UNKNOWN = "dnd5e-text-parser.Note.EffectUnknown";
// Fixed score written "Strength: 23", "Force : 21", or as variants "Hill Giant Strength: 21. Storm Giant Strength: 29."
// (on the accent-folded text; "Strength: DC 14" and "Strength: +2" are not scores)
const SCORE_COLON = new RegExp(String.raw`(?<![\p{L}])((?:[\p{L}/'-]+\s+){1,3}?)?(${ABILITY_RE})\s*:\s*(\d{1,2})(?![\d+])`, "giu");
// "your Strength score changes to a score granted by the belt" names the ability of variants written "<Name>: N"
const SCORE_CONTEXT_EN = /\byour\s+(\p{L}+)(?:\s+score)?\s+(?:changes|is\s+set|becomes)\s+to\s+(?:a|the)\s+(?:score|value)/iu;
const SCORE_CONTEXT_FR = /\bvotre\s+(?:(?:valeur|score)\s+(?:de\s+|d'))?(\p{L}+)\s+(?:passe|devient|est\s+port[ée]e?)\s+[àa]\s+(?:la|une)\s+valeur/iu;
const SCORE_NAMED = /(?<![\p{L}])([\p{L}][\p{L} '/-]{1,40}?)\s*:\s*(\d{1,2})(?!\d)(?=\s*(?:[.;,\n]|$))/gu;
const VARIANT_NOISE = new Set(["giant", "geant", "geants", "de", "des", "du", "of", "the", "and", "or", "ou", "et", "a", "an", "un", "une", "le", "la", "les"]);
const NOTE_SCORE_CHOICES = "dnd5e-text-parser.Note.AbilityScoreChoices";

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

/** Skill named in a check phrase ("Wisdom (Survival) checks", "tests de Dextérité (Discrétion)", "Stealth checks"). */
function skillIn(phrase, langs) {
  const paren = phrase.match(/\(([^)]+)\)/u);
  if ( paren ) {
    const key = lookup("skills", paren[1], langs);
    if ( key ) return key;
  }
  for ( const word of phrase.match(/[\p{L}'-]+/gu) ?? [] ) {
    const key = lookup("skills", word, langs);
    if ( key ) return key;
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
    // A bonus limited to a skill ("Wisdom (Survival) checks") is a skill bonus, never a bonus to the whole ability
    const skill = skillIn(object, langs);
    result.push(skill ? { ...make("check", skill), on: "skill" } : make("check", abilityIn(object)));
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
 * Fixed ability scores written with a colon: "Strength: 23", "Force : 21", or variants "Hill Giant Strength: 21.
 * Storm Giant Strength: 29." / "Géant des collines : 21" (the ability then comes from "your Strength score changes
 * to a score granted by the belt"). A variant named in the item name is chosen; otherwise the choices are reported.
 * @param {string} source
 * @param {object} ctx  `{ name, languages }`.
 * @returns {{ effects: object[], ambiguous: object[], spans: object[] }}
 */
function scoreVariants(source, ctx) {
  const folded = fold(source);
  const variants = [];
  const capitalized = (start, end) => source.slice(start, end).split(/\s+/).filter(word => /^\p{Lu}/u.test(word));
  for ( const match of folded.matchAll(SCORE_COLON) ) {
    const ability = abilityKey(match[2]);
    if ( !ability ) continue;
    const nameEnd = match.index + (match[1]?.length ?? 0);
    // "your Intelligence: 19": only capitalized words make a variant name ("Hill Giant")
    const name = match[1] ? capitalized(match.index, nameEnd).join(" ") : "";
    variants.push({ ability, name, value: Number(match[3]), start: match.index, end: match.index + match[0].length });
  }
  const context = [hasLang(ctx, "en") && SCORE_CONTEXT_EN, hasLang(ctx, "fr") && SCORE_CONTEXT_FR]
    .filter(Boolean).map(re => source.match(re)).find(Boolean);
  const contextAbility = context ? abilityKey(context[1]) : null;
  if ( contextAbility ) {
    for ( const match of source.matchAll(SCORE_NAMED) ) {
      if ( variants.some(variant => match.index < variant.end && match.index + match[0].length > variant.start) ) continue;
      if ( abilityKey(match[1].trim().split(/\s+/).at(-1)) ) continue;
      variants.push({ ability: contextAbility, name: match[1].trim(), value: Number(match[2]), start: match.index, end: match.index + match[0].length });
    }
  }
  const effects = [];
  const ambiguous = [];
  const spans = variants.map(variant => ({ kind: "effect", start: variant.start, end: variant.end, text: source.slice(variant.start, variant.end) }));
  const itemName = fold(ctx.name ?? "");
  for ( const ability of new Set(variants.map(variant => variant.ability)) ) {
    const group = variants.filter(variant => variant.ability === ability);
    const values = [...new Set(group.map(variant => variant.value))];
    const named = group.filter(variant => fold(variant.name).split(/[\s/]+/)
      .some(word => word.length >= 3 && !VARIANT_NOISE.has(word) && itemName.includes(word)));
    const chosen = values.length === 1 ? values : [...new Set(named.map(variant => variant.value))];
    const raw = group.map(variant => source.slice(variant.start, variant.end));
    if ( chosen.length === 1 ) effects.push({ kind: "abilityScore", value: chosen[0], scope: ability, raw: raw.join(" ") });
    else ambiguous.push({ key: NOTE_SCORE_CHOICES, data: { ability, choices: group.map(({ name, value }) => ({ name, value })), raw } });
  }
  return { effects, ambiguous, spans };
}

/**
 * @param {string} text  Plain text.
 * @param {object} [ctx]  `{ languages, name }`.
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
    const endOf = match => match.index + match[0].length;
    const skip = match => isNegated(s, match.index, endOf(match));

    for ( const [re, lang] of [[BONUS_EN, "en"], [BONUS_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) ) continue;
        // "+1 bonus to saving throws against spells" is not a general bonus
        if ( AGAINST_TAIL.test(s.slice(endOf(match))) ) {
          ambiguous.push({ key: NOTE_UNKNOWN, data: { kind: "bonus", text: match[0] } });
          continue;
        }
        add(bonusEffects(match[2], `+${match[1]}`, raw, langs));
      }
    }
    // "a bonus to spell attack rolls of +1"
    for ( const [re, lang] of [[BONUS_OF_EN, "en"], [BONUS_OF_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) ) continue;
        add(bonusEffects(match[1], `+${match[2]}`, raw, langs));
      }
    }

    for ( const [re, lang] of [[TRAIT_EN, "en"], [TRAIT_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) || isNotWearer(s, match.index) ) continue;
        const object = (match[2] ?? match[4]).trim();
        if ( THIS_EFFECT.test(object) ) continue;
        const word = fold(match[1] ?? match[3]);
        const kind = word.startsWith("resist") ? "resistance" : word.startsWith("immun") ? "immunity" : "vulnerability";
        const result = traitEffects(kind, object, raw, langs, lang);
        add(result.effects);
        ambiguous.push(...result.notes);
      }
    }

    for ( const [re, lang] of [[ADVANTAGE_EN, "en"], [ADVANTAGE_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) || isNotWearer(s, match.index) ) continue;
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
        if ( skip(match) || isNotWearer(s, match.index) || THIS_EFFECT.test(match[2].trim()) ) continue;
        const result = traitEffects("immunity", match[2].trim(), raw, langs, lang);
        add(result.effects);
        ambiguous.push(...result.notes);
      }
    }

    for ( const [re, lang] of [[AGAINST_EN, "en"], [AGAINST_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) || isNotWearer(s, match.index) ) continue;
        for ( const part of match[1].split(AGAINST_SPLIT) ) {
          const word = part.replace(/^(?:and|et)\s+/iu, "").replace(/^against\s+|^contre\s+/iu, "")
            .replace(AGAINST_NOISE, "").trim();
          // Whatever it is limited to ("the breath weapons of dragons"), it is never a general advantage
          const against = conditionKey(word) ?? damageKey(word) ?? (fold(word).replace(/\s+/g, " ").slice(0, 80) || null);
          if ( against ) add([{ kind: "advantage", value: null, scope: null, on: "save", against, raw }]);
        }
      }
    }

    for ( const [re, lang] of [[SCORE_EN, "en"], [SCORE_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) ) continue;
        const scope = abilityKey(match[1]);
        if ( scope ) add([{ kind: "abilityScore", value: Number(match[2]), scope, raw }]);
      }
    }

    for ( const [re, lang] of [[SPEED_EN, "en"], [SPEED_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) ) continue;
        const value = lang === "en" ? Number(match[1]) : toFeet(parseNumber(match[1]), "m");
        add([{ kind: "speed", value, scope: null, raw }]);
      }
    }
    // "a flying speed of 60 feet", "vitesse de vol de 18 m"
    for ( const [re, lang] of [[MOVEMENT_EN, "en"], [MOVEMENT_FR, "fr"]] ) {
      if ( !hasLang(ctx, lang) ) continue;
      for ( const match of s.matchAll(re) ) {
        if ( skip(match) ) continue;
        const scope = MOVEMENT[fold(match[1]).replace(/ing$/, "")];
        const value = lang === "en" ? Number(match[2])
          : toFeet(parseNumber(match[2]), /^m/i.test(match[3]) ? "m" : "ft");
        if ( scope && Number.isFinite(value) ) add([{ kind: "speed", value, scope, raw }]);
      }
    }

    if ( effects.length > before ) {
      spans.push({ kind: "effect", start: sentence.index, end: sentence.index + s.length, text: s });
    }
  }

  // "Strength: 23" and variant tables, on the whole text
  const scores = scoreVariants(source, ctx);
  const sentences = splitSentences(source);
  for ( const effect of scores.effects ) {
    const at = source.indexOf(effect.raw.split(" ")[0]);
    const sentence = sentences.find(entry => at >= entry.index && at < entry.index + entry.text.length) ?? sentences[0];
    effects.push({
      ...effect, origin: ORIGIN, when: "passive", duration: null, activity: null,
      sentence: sentence ? { start: sentence.index, end: sentence.index + sentence.text.length } : { start: 0, end: 0 }
    });
  }
  ambiguous.push(...scores.ambiguous);
  spans.push(...scores.spans);
  return { fact: effects, spans, ambiguous, notes: [] };
}
