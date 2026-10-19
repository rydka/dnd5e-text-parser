import { htmlToText, splitSentences, nameKey } from "./text.mjs";
import { recognizeAttack } from "./recognizers/attack.mjs";
import { recognizeRangeTarget } from "./recognizers/range-target.mjs";
import { recognizeDamage, formulaOf } from "./recognizers/damage.mjs";
import { recognizeSaveArea } from "./recognizers/save-area.mjs";
import { recognizeUses } from "./recognizers/uses.mjs";
import { recognizeActivation } from "./recognizers/activation.mjs";
import { recognizeLegendary } from "./recognizers/legendary.mjs";
import { recognizeFeatureEffects } from "./recognizers/feature-effects.mjs";

export { nameKey } from "./text.mjs";
export { parseActor } from "./actor-plan.mjs";
export { parseItem } from "./item-plan.mjs";

const SCHEMA_VERSION = 1;
const MULTIATTACK = /^(?:multiattack|attaques? multiples?)(?![\p{L}])/u;

/** An empty `FeaturePlan`. */
function emptyPlan() {
  return {
    schema: SCHEMA_VERSION, skip: null, activation: null, attack: null, range: null, target: null, damage: [],
    save: null, template: null, uses: null, recharge: null, legendaryResistance: null,
    variants: [], effects: [], notes: [], ambiguous: [], unrecognized: []
  };
}

// "at the start of each of its turns", "at the start of each of the behir's turns", "au début de chacun de ses tours"
const ONGOING_PHRASE = String.raw`(?:(?:at\s+the\s+)?(?:start|beginning|end)\s+of\s+(?:(?:each\s+of|every)\s+)?` +
  String.raw`(?:(?:its|their|the\s+(?:[\p{L}-]+\s+){0,2}?[\p{L}-]+'s)\s+)?turns?|` +
  String.raw`au\s+(?:d[ée]but|fin)\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?|` +
  String.raw`[àa]\s+la\s+fin\s+de\s+(?:chacun\s+de\s+(?:ses|leurs)|son|leur)\s+tours?)`;
const ONGOING_AFTER = new RegExp(String.raw`^[^.]{0,40}?${ONGOING_PHRASE}`, "iu");
// "...at the start of each of its turns or take 12 (2d8 + 3) damage" is the damage of a repeated save, not ongoing
const ONGOING_BEFORE = new RegExp(String.raw`${ONGOING_PHRASE}(?:(?!\b(?:or|ou)\s+(?:takes?|subit))[^.]){0,40}$`, "iu");
const overlaps = (span, other) => span.start < other.end && span.end > other.start;
// Conditional damage (B9): a second result "6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the
// creature is Bloodied" or extra damage "takes an extra 2d6 Fire damage if the target is undead" is never rolled
// with the main result: dnd5e 6 rolls every part of an activity together.
// What introduces the condition right after the damage: "if", "when", "while", "unless", "at range", "in melee",
// "in bear form", "si", "lorsque", "quand", "tant que", "à distance", "au corps à corps", "sous forme de loup"
const COND_START = String.raw`(?:if|when|while|unless|at\s+range|in\s+melee|in\s+(?:[\p{L}'-]+\s+){0,3}?form|` +
  String.raw`si|lorsque|lorsqu'|quand|tant\s+que|[àa]\s+(?:distance|port[ée]e)|au\s+corps\s+[àa]\s+corps|sous\s+(?:sa\s+|la\s+)?forme)(?![\p{L}])`;
const COND_AFTER = new RegExp(String.raw`^\s*(?:(?:suppl[ée]mentaires?|en\s+plus)\s+)?${COND_START}`, "iu");
// ", or an extra" / "—or" (a dash, normalized to "-" by htmlToText) before the alternative; the first result may carry
// its own condition ("7 (1d6 + 4) piercing damage in melee or 5 (1d4 + 3) piercing damage at range", "in Small or
// Medium form, or 10 (2d6 + 3)...")
const ALT_LEAD = /(?:,|\s*-)?\s*(?:or|ou)\s+(?:(?:an?|une?|des?)\s+)?(?:(?:extra|additional|suppl[ée]mentaires?)\s+)?$/iu;
const ALT_SEP = new RegExp(String.raw`^(?:\s*${COND_START}[^.;,]{0,60}?)?\s*${ALT_LEAD.source}`, "iu");
// "takes an extra", "deals an additional", "also takes", "subit également", "inflige en plus"
const EXTRA_LEAD = /\b(?:(?:an?|une?|des?)\s+)?(?:extra|additional|also\s+(?:takes?|deals?|suffers?)|suppl[ée]mentaires?|en\s+plus|(?:subit|subissent|inflige|infligent)\s+(?:aussi|[ée]galement))\s+(?:(?:an?|une?|des?)\s+)?$/iu;
const EXTRA_RAW = /\b(?:extra|additional)\b/iu;
// French puts the word after the type: "2d6 dégâts de feu supplémentaires si..."
const EXTRA_TRAIL = /^\s*(?:suppl[ée]mentaires?|en\s+plus)(?![\p{L}])/iu;
// The condition runs to the end of its clause (not into ", and the target..." / ", or N (dice)...")
const COND_TEXT = /^\s*(?:(?!,\s*(?:and|or|et|ou)(?![\p{L}]))[^.;\n]){0,120}/u;
// The condition stated first, at the start of the sentence of an extra: "If the target moved 20+ feet straight
// toward it immediately before the hit, the target takes an extra 7 (2d6) Bludgeoning damage", "Si la cible…, elle
// subit 7 (2d6) dégâts contondants supplémentaires"
const COND_BEFORE = new RegExp(String.raw`^\s*((?:if|when|while|unless|si|lorsque|lorsqu'|quand|tant\s+que)(?![\p{L}])[^.;\n]{1,160}?),\s*[^,.;\n]{0,60}$`, "iu");
// "at range" / "in melee": the variant is the other side of a weapon used both ways (its own attack type and range)
const RANGED_COND = /^(?:at\s+range|[àa]\s+(?:distance|port[ée]e))(?![\p{L}])/iu;
const MELEE_COND = /^(?:in\s+melee|au\s+corps\s+[àa]\s+corps)(?![\p{L}])/iu;

/**
 * Name of the activity of a conditional variant: "Bite (if the target is Bloodied)".
 * @param {string} base       Name of the feature or of the base activity ("" when unknown).
 * @param {string} condition  Condition as written in the text.
 * @returns {string}
 */
export function variantName(base, condition) {
  const name = String(base ?? "").replace(/\s*\([^()]*\)\s*$/u, "").trim();   // "Spear (Recharge 5-6)" -> "Spear"
  return name ? `${name} (${condition})` : `(${condition})`;
}

/**
 * ActivityPlan of a conditional result (B9): the same attack (or save) as the plan, with the damage of that case.
 * @param {object} plan   FeaturePlan being built (attack, save, range, target, template, activation).
 * @param {string} title  Feature name.
 * @param {{condition: string, raw: string, save: boolean, damage: object[], extraDamage: object|null}} variant
 * @returns {object}
 */
function variantOf(plan, title, { condition, raw, save, damage, extraDamage }) {
  let attack = save ? null : plan.attack;
  if ( attack && (RANGED_COND.test(condition) || MELEE_COND.test(condition)) ) {
    attack = { ...attack, type: RANGED_COND.test(condition) ? "ranged" : "melee" };
  }
  return {
    kind: save ? "save" : (attack ? "attack" : "damage"), name: variantName(title, condition), condition, raw, index: -1,
    activation: plan.activation, attack, range: plan.range, target: plan.target, template: plan.template,
    damage: save ? [] : damage, save: save ? { ...plan.save, damage } : null,
    heal: null, cast: null, consume: null, extraDamage: save ? null : extraDamage, origin: "rules"
  };
}

/**
 * Readable text of an unrecognized sentence: tokens made only of punctuation (what is left of the passages cut out
 * around it, ". . , , (range 20/60). .") are dropped. `null` when fewer than two tokens with a letter or a digit
 * remain: a lone word or bare punctuation is not a sentence worth reporting or asking a resolver about.
 * @param {string} text
 * @returns {string|null}
 */
function cleanUnrecognized(text) {
  const tokens = text.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token));
  return tokens.length < 2 ? null : tokens.join(" ");
}

/**
 * Parse the text of a feature (monster action, trait, item) into a `FeaturePlan` (pure, deterministic).
 * Multiattack is never interpreted (`skip: "multiattack"`). Nothing is invented: ambiguous facts are left out
 * and listed in `ambiguous`; sentences no recognizer covered are listed in `unrecognized`.
 * @param {string} name  Feature name (may carry "(Recharge 5-6)", "(3/Day)", "(Costs 2 Actions)").
 * @param {string} html  Description (HTML or plain text).
 * @param {{ languages?: ("en"|"fr")[], keys?: object, featureEffects?: boolean }} [opts]  `featureEffects: false`
 *   leaves `plan.effects` empty (`parseItem` reads the effects of an item itself).
 * @returns {object} FeaturePlan
 */
export function parseFeature(name, html, opts = {}) {
  const plan = emptyPlan();
  const title = String(name ?? "");
  if ( MULTIATTACK.test(nameKey(title)) ) {
    plan.skip = "multiattack";
    return plan;
  }
  const text = htmlToText(html);
  const ctx = { languages: opts.languages, keys: opts.keys, name: title, html: String(html ?? "") };

  const attack = recognizeAttack(text, ctx);
  const rangeTarget = recognizeRangeTarget(text, ctx);
  const damage = recognizeDamage(text, ctx);
  const saveArea = recognizeSaveArea(text, ctx);
  const uses = recognizeUses(text, ctx);
  const activation = recognizeActivation(text, ctx);
  const offset = title.length + 1;
  const legendary = recognizeLegendary(`${title}\n${text}`);
  const legendarySpans = (legendary.spans ?? [])
    .map(span => ({ ...span, start: span.start - offset, end: span.end - offset })).filter(span => span.end > 0);

  const results = [attack, rangeTarget, damage, saveArea, uses, activation, legendary];
  for ( const result of results ) {
    plan.ambiguous.push(...(result.ambiguous ?? []));
    plan.notes.push(...(result.notes ?? []));
  }

  plan.activation = activation.fact;
  plan.attack = attack.fact;
  plan.range = rangeTarget.fact.range;
  plan.target = rangeTarget.fact.target;
  plan.save = saveArea.fact.save;
  plan.template = saveArea.fact.template;
  plan.uses = uses.fact.uses;
  plan.recharge = uses.fact.recharge;
  plan.legendaryResistance = legendary.fact?.legres ?? null;
  // Legendary Resistance is a trait, even when filed under a "Legendary Actions" header (C12)
  if ( plan.legendaryResistance && plan.activation?.type === "legendary" ) plan.activation = null;

  // Attack type from the range when the text has no "Melee"/"Ranged" header
  if ( plan.attack && !plan.attack.type && plan.range ) {
    const { reach, value } = plan.range;
    if ( reach !== null ) plan.attack.type = "melee";
    else if ( value !== null ) plan.attack.type = "ranged";
    if ( reach !== null && value !== null ) {
      plan.notes.push({ key: "dnd5e-text-parser.Note.RangeNotCarried", data: { reach, value } });
    }
  }

  // Damage: on hit (before the save) or damage alone; damage of the save after it
  const saveSpan = saveArea.spans.find(span => span.kind === "save");
  const saveStart = plan.save && saveSpan ? saveSpan.start : Infinity;
  const chains = [];
  let cursor = 0;
  for ( const chain of damage.chains ) {
    const spans = damage.spans.slice(cursor, cursor + chain.length);
    cursor += chain.length;
    // "9 (2d8) Slashing damage plus 7 (2d6) Fire damage if the target is undead": the condition is the last part's
    const alternative = chains.length && ALT_SEP.test(text.slice(chains.at(-1).end, spans[0].start));
    if ( chain.length > 1 && !alternative && COND_AFTER.test(text.slice(spans.at(-1).end, spans.at(-1).end + 40)) ) {
      chains.push({ parts: chain.slice(0, -1), start: spans[0].start, end: spans.at(-2).end });
      chains.push({ parts: chain.slice(-1), start: spans.at(-1).start, end: spans.at(-1).end, split: true });
      continue;
    }
    chains.push({ parts: chain, start: spans[0].start, end: spans.at(-1).end });
  }
  // Ongoing damage of a condition ("takes 21 (6d6) acid damage at the start of each of its turns" while swallowed,
  // poisoned, grappled...) is never the damage of a saving throw: it rides on the attack when there is one, else it
  // stands as its own damage activity next to the save (`toActivities`).
  const isOngoing = chain => ONGOING_AFTER.test(text.slice(chain.end, chain.end + 80))
    || ONGOING_BEFORE.test(text.slice(Math.max(0, chain.start - 90), chain.start));
  // Conditional damage (B9): a second result ("or N (dice) type damage if...") or extra damage followed by its
  // condition is never a part rolled with the main result (dnd5e 6 rolls every part of an activity together). It
  // gives `Note.ConditionalDamage` in `ambiguous` and a variant in `plan.variants`: an ActivityPlan with `condition`
  // that `toActivities` turns into a second activity (same attack or save, named after the condition).
  const conditional = new Map();
  const sentences = splitSentences(text);
  const sentenceStart = offset => sentences.findLast(sentence => sentence.index <= offset)?.index ?? 0;
  chains.forEach((chain, index) => {
    if ( isOngoing(chain) ) return;
    const after = text.slice(chain.end, chain.end + 40);
    const lead = text.slice(Math.max(0, chain.start - 40), chain.start);
    const previous = chains[index - 1];
    const alt = Boolean(previous && ALT_SEP.test(text.slice(previous.end, chain.start)));
    const extra = chain.split || EXTRA_LEAD.test(lead) || chain.parts.some(part => EXTRA_RAW.test(part.raw)) || EXTRA_TRAIL.test(after);
    if ( !alt && !extra ) return;
    if ( COND_AFTER.test(after) ) {
      const leadMatch = lead.match(alt ? ALT_LEAD : EXTRA_LEAD);
      const start = leadMatch ? chain.start - (lead.length - leadMatch.index) : chain.start;
      const next = chains[index + 1];
      // The clause ends before the next result ("... in melee or 5 (1d4 + 3) ...") or the next sentence part
      const tail = text.slice(chain.end, next ? next.start : undefined).match(COND_TEXT)[0]
        .replace(/\s*,?\s*(?:\b(?:or|ou|and|et))?\s*,?\s*$/iu, "");
      conditional.set(chain, { condition: tail.trim(), alt, raw: text.slice(start, chain.end + tail.length).trim().replace(/^[,-]\s*/, "") });
      return;
    }
    // Extra damage whose condition opens its sentence: "If the target ..., the target takes an extra 7 (2d6) ..."
    if ( alt ) return;
    const start = sentenceStart(chain.start);
    const head = text.slice(start, chain.start).match(COND_BEFORE);
    if ( !head ) return;
    conditional.set(chain, { condition: head[1].trim(), alt: false, raw: text.slice(start, chain.end).trim() });
  });
  // C4: damage that depends on an ambiguous save (several different saving throws, "Wall of Ice") is withheld with
  // it: no damage activity is invented for an ability whose damage belongs to the unresolved save. An ambiguous
  // attack (several bonuses) keeps its written damage: only the bonus is left out (L3, nothing invented).
  const withheld = !plan.save && saveArea.ambiguous?.length;
  // The main results: the damage of the hit (or the damage alone) and the damage of the save
  const mainResults = () => {
    const direct = chains.filter(chain => !isOngoing(chain) && !conditional.has(chain));
    const before = direct.filter(chain => chain.start < saveStart);
    const after = direct.filter(chain => chain.start >= saveStart);
    if ( withheld ) return { direct, hit: null, onSave: null };
    if ( plan.save && !plan.attack ) return { direct, hit: null, onSave: after[0] ?? before[0] ?? null };
    return { direct, hit: before[0] ?? (plan.save ? null : direct[0]) ?? null, onSave: plan.save ? (after[0] ?? null) : null };
  };
  let { direct, hit, onSave } = mainResults();
  // A variant only stands next to a main result. Without one ("deals an extra 4d6 piercing damage when it hits...
  // and has advantage", Sneak Attack), the conditional damage is the damage of the feature itself.
  if ( conditional.size && !hit && !onSave ) {
    conditional.clear();
    ({ direct, hit, onSave } = mainResults());
  }
  if ( withheld && direct.length ) {
    plan.ambiguous.push({ key: "dnd5e-text-parser.Note.DamageWithheld", data: { raw: direct.flatMap(chain => chain.parts.map(part => part.raw)) } });
  }
  if ( hit ) plan.damage = hit.parts;
  if ( plan.save && onSave ) plan.save.damage = onSave.parts;
  const pending = [];     // conditional chains, with the result each one stands in for
  let previous = null;    // list the parts of the chain just before went to
  for ( const chain of chains ) {
    let list = null;
    if ( chain === hit ) list = plan.damage;
    else if ( chain === onSave ) list = plan.save.damage;
    else if ( conditional.has(chain) ) {
      const info = conditional.get(chain);
      for ( const part of chain.parts ) {
        plan.ambiguous.push({
          key: "dnd5e-text-parser.Note.ConditionalDamage",
          data: { formula: formulaOf(part), type: part.type ?? "", condition: info.condition, raw: info.raw }
        });
      }
      // It stands in for the damage of the save when it follows it, else for the hit (or the damage alone)
      if ( !withheld ) pending.push({ chain, ...info, save: previous != null && previous === plan.save?.damage });
      list = previous;
    } else if ( isOngoing(chain) ) {
      plan.damage.push(...chain.parts);
      list = plan.damage;
    } else if ( !withheld ) {
      plan.notes.push({ key: "dnd5e-text-parser.Note.ExtraDamageIgnored", data: { raw: chain.parts.map(part => part.raw) } });
    }
    previous = list;
  }
  for ( const { chain, condition, raw, alt, save } of pending ) {
    if ( save && !onSave ) continue;
    const baseChain = save ? onSave : hit;
    const baseList = save ? plan.save.damage : plan.damage;
    // An alternative replaces the result (ongoing damage riding on it stays); extra damage adds to it
    const rest = baseList.filter(part => !baseChain?.parts.includes(part));
    const damage = alt ? [...chain.parts, ...rest] : [...baseList, ...(save ? chain.parts : chain.parts.slice(1))];
    const extraDamage = alt || save ? null : chain.parts[0];
    plan.variants.push(variantOf(plan, title, { condition, raw, save, damage, extraDamage }));
  }

  // Passive feature (a trait: no activation, no attack, no save): the effects dnd5e applies by itself go to
  // `plan.effects` (`toEffects` writes them as one ActiveEffect transferred to the actor); what cannot be applied
  // without inventing it (limited advantage, aura, "reduced to 1 hit point instead") gives `Note.NotAutomated`
  const passive = opts.featureEffects !== false && !plan.activation && !plan.attack && !plan.save && !plan.legendaryResistance;
  const featureEffects = passive ? recognizeFeatureEffects(text, ctx) : { fact: [], spans: [], ambiguous: [], notes: [] };
  plan.effects = featureEffects.fact.map(effect => Object.fromEntries(Object.entries(effect).filter(([key]) => key !== "sentence")));
  plan.notes.push(...featureEffects.notes);
  plan.ambiguous.push(...featureEffects.ambiguous);

  // Sentences that no recognizer covered
  const spans = [...attack.spans, ...rangeTarget.spans, ...damage.spans, ...(damage.covered ?? []), ...saveArea.spans,
    ...uses.spans, ...activation.spans, ...legendarySpans, ...featureEffects.spans];
  for ( const sentence of sentences ) {
    const span = { start: sentence.index, end: sentence.index + sentence.text.length };
    if ( spans.some(other => overlaps(span, other)) ) continue;
    const cleaned = cleanUnrecognized(sentence.text);
    if ( cleaned ) plan.unrecognized.push({ text: cleaned, index: sentence.index });
  }
  return plan;
}
