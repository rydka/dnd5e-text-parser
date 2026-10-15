import { htmlToText, splitSentences } from "./text.mjs";
import { parseFeature, variantName } from "./plan.mjs";
import { recognizeItemMeta } from "./recognizers/item-meta.mjs";
import { recognizeWeapon } from "./recognizers/weapon.mjs";
import { recognizeArmor } from "./recognizers/armor.mjs";
import { recognizeConsumable } from "./recognizers/consumable.mjs";
import { recognizeMagicEffects } from "./recognizers/magic-effects.mjs";
import {
  segmentText, recognizeItemActivation, recognizeHeal, recognizeCast, recognizeConsume, recognizeDuration,
  hasUseTrigger, hasPassiveMarker, recognizeCastList
} from "./recognizers/item-activity.mjs";

const EXTRA = /\b(?:extra|additional|supplémentaires?|supplementaires?|en plus)\b/iu;
// French puts the word after the type: "2d6 dégâts de feu supplémentaires"
const EXTRA_AFTER = /^\s*(?:suppl[ée]mentaires?|en\s+plus)(?![\p{L}])/iu;
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

/**
 * Text with the given spans removed (each removed range leaves one space).
 * @param {string} text
 * @param {{start: number, end: number}[]} spans
 * @param {number} [from]
 * @param {number} [to]
 * @returns {string}
 */
function cutSpans(text, spans, from = 0, to = text.length) {
  const ranges = spans.map(span => [Math.max(span.start, from), Math.min(span.end, to)])
    .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let out = "";
  let position = from;
  for ( const [start, end] of ranges ) {
    if ( end <= position ) continue;
    if ( start > position ) out += text.slice(position, start);
    out += " ";
    position = end;
  }
  return out + text.slice(position, to);
}

/** Copy of an activation without its working `index`. */
const withoutIndex = ({ index, ...activation }) => (void index, activation);

/** Bold lead-ins of the HTML ("<strong>Command Word.</strong>"), as plain text. */
function leadIns(html) {
  return [...String(html ?? "").matchAll(/<(?:strong|b)>\s*([^<]{2,50}?)\s*[.:]?\s*<\/(?:strong|b)>/giu)]
    .map(match => htmlToText(match[1])).filter(Boolean);
}

/** Short name of an activity: bold lead-in, spell name, or "command word". */
function nameOf(segmentText, leads, cast) {
  const lead = leads.find(entry => segmentText.startsWith(entry));
  if ( lead ) return lead;
  if ( cast ) return cast.name;
  if ( /command word/i.test(segmentText) ) return "Command Word";
  if ( /mot de commande/i.test(segmentText) ) return "Mot de commande";
  return "";
}

/**
 * Parse the text of an item (weapon, armor, consumable, wondrous item...) into an `ItemPlan`: the `FeaturePlan`
 * of the text left once the item details are read, plus `details`, `effects` and `activities` (pure, deterministic).
 * Item details are never written for a fact the text does not state.
 * @param {string} name  Item name (a "+1" in it gives the magical bonus of a weapon or armor).
 * @param {string} html  Description (HTML or plain text).
 * @param {{ languages?: ("en"|"fr")[], keys?: object, itemType?: string }} [opts]
 * @returns {object} ItemPlan
 */
export function parseItem(name, html, opts = {}) {
  const title = String(name ?? "");
  const text = htmlToText(html);
  // The effects of an item are read here (`recognizeMagicEffects`), not by `parseFeature`
  const parseOpts = { languages: opts.languages, keys: opts.keys, featureEffects: false };
  const ctx = { ...parseOpts, name: title, itemType: opts.itemType };

  const meta = recognizeItemMeta(text, ctx);
  const weapon = recognizeWeapon(text, ctx, meta.fact);
  const armor = recognizeArmor(text, ctx, meta.fact);
  const consumable = recognizeConsumable(text, ctx, meta.fact);
  const magic = recognizeMagicEffects(text, ctx);

  const itemSpans = [...meta.spans, ...weapon.spans, ...armor.spans, ...consumable.spans, ...magic.spans];

  // A bonus stated by the weapon / armor recognizers is a magical bonus, and stealth disadvantage an armor
  // property: neither is an effect
  const taken = [...weapon.spans, ...armor.spans].filter(span => span.role);
  const effects = magic.fact.filter(effect => !taken.some(span => overlaps(span, effect.sentence)
    && (span.role === "bonus" ? ["ac", "attack", "damage"] : ["advantage", "disadvantage"]).includes(effect.kind)));

  // Details
  const details = {};
  const fact = meta.fact;
  if ( fact.rarity ) details.rarity = fact.rarity;
  if ( fact.attunement ) details.attunement = fact.attunement;
  if ( fact.attunementCondition ) details.attunementCondition = fact.attunementCondition;
  if ( fact.weight ) details.weight = fact.weight;
  if ( fact.price ) details.price = fact.price;
  if ( fact.magical ) details.magical = true;
  if ( weapon.fact ) details.weapon = weapon.fact;
  if ( armor.fact ) details.armor = armor.fact;
  if ( consumable.fact ) details.consumable = consumable.fact;
  else if ( consumable.charges ) details.charges = consumable.charges;

  // Segments -> activities
  const leads = leadIns(html);
  const segments = segmentText(text, ctx).map(segment => ({ ...segment, effects: [] }));
  const segmentOf = offset => segments.find(segment => offset >= segment.start && offset < segment.end);
  const activitySpans = [];
  const coverSpans = [];
  const sentences = splitSentences(text).map(sentence => ({ start: sentence.index, end: sentence.index + sentence.text.length }));
  const sentenceAt = offset => sentences.find(sentence => offset >= sentence.start && offset < sentence.end);
  const notes = [];
  const ambiguous = [];
  const orphanVariants = [];   // conditional variants of segments that give no activity of their own

  // Spells cast for charges (staffs, wands): the intro and the list / table are covered, one cast activity per spell
  const castList = recognizeCastList(text, ctx);
  const listSegment = castList ? segments.find(segment => castList.start >= segment.start && castList.start < segment.end) : null;
  if ( castList ) {
    coverSpans.push({ start: castList.start, end: castList.end });
    activitySpans.push({ start: castList.start, end: castList.end });
  }

  for ( const segment of segments ) {
    segment.activation = recognizeItemActivation(segment.text, ctx);
    segment.heal = recognizeHeal(segment.text, ctx);
    segment.cast = recognizeCast(segment.text, ctx);
    segment.consume = recognizeConsume(segment.text, ctx);
    segment.duration = recognizeDuration(segment.text, ctx);
    for ( const found of [segment.heal, segment.cast, segment.consume] ) {
      if ( !found ) continue;
      const span = found.span;
      activitySpans.push({ start: segment.start + span.start, end: segment.start + span.end });
    }
    // The sentences that carry an activity fact are interpreted (the rest of the paragraph may not be)
    for ( const offset of [segment.heal?.span.start, segment.cast?.span.start, segment.consume?.span.start,
      segment.activation?.index] ) {
      const sentence = Number.isInteger(offset) ? sentenceAt(segment.start + offset) : null;
      if ( sentence ) coverSpans.push(sentence);
    }
  }

  // Effects: passive (carried / worn) or applied on use
  for ( const effect of effects ) {
    const segment = segmentOf(effect.sentence.start);
    if ( !segment ) continue;
    const duration = recognizeDuration(effect.raw, ctx);
    const passive = hasPassiveMarker(effect.raw, ctx);
    const onUse = !passive && (duration || segment.activation || hasUseTrigger(segment.text, ctx));
    if ( onUse ) {
      effect.when = "onUse";
      effect.duration = duration ?? segment.duration ?? null;
      segment.forced = true;
      segment.effects.push(effect);
    }
  }

  const activities = [];
  for ( const segment of segments ) {
    const cutSegment = cutSpans(text, [...itemSpans, ...activitySpans], segment.start, segment.end);
    const feature = parseFeature("", cutSegment, parseOpts);
    notes.push(...feature.notes.filter(note => note.key.endsWith("DamageTypeFromWeapon")));
    const extra = [];
    const damage = [];
    for ( const part of feature.damage ) {
      const at = cutSegment.indexOf(part.raw);
      const lead = at >= 0 ? cutSegment.slice(Math.max(0, at - 40), at) : "";
      const trail = at >= 0 ? cutSegment.slice(at + part.raw.length, at + part.raw.length + 30) : "";
      (EXTRA.test(lead) || EXTRA.test(part.raw) || EXTRA_AFTER.test(trail) ? extra : damage).push(part);
    }
    if ( segment === listSegment ) {
      const activation = segment.activation ? withoutIndex(segment.activation) : feature.activation;
      for ( const entry of castList.entries ) {
        const activity = {
          kind: "cast", name: entry.name, raw: entry.raw, index: -1, activation,
          attack: null, range: null, target: null, template: null, damage: [], save: null, heal: null,
          cast: { name: entry.name, level: entry.level, dc: castList.dc, attack: null, charges: entry.charges,
            raw: entry.raw, origin: "rules" },
          consume: { target: "itemUses", amount: entry.charges, raw: entry.raw, origin: "rules" },
          extraDamage: null, origin: "rules"
        };
        segment.activity ??= activity;
        activities.push(activity);
      }
      continue;
    }
    // Conditional variants (B9) of the segment: a second activity each, named after the condition
    ambiguous.push(...feature.ambiguous.filter(note => note.key.endsWith("ConditionalDamage")));
    const keep = segment.activation || segment.heal || segment.cast || segment.consume || segment.forced
      || feature.attack || feature.save || damage.length || extra.length;
    if ( !keep ) {
      orphanVariants.push(...feature.variants);
      continue;
    }
    if ( extra.length > 1 ) {
      notes.push({ key: "dnd5e-text-parser.Note.ExtraDamageIgnored", data: { raw: extra.slice(1).map(part => part.raw) } });
    }
    const kind = segment.cast ? "cast" : segment.heal ? "heal" : feature.save && !feature.attack ? "save"
      : feature.attack ? "attack" : damage.length ? "damage" : "utility";
    const leadIn = leads.find(entry => segment.text.startsWith(entry));
    if ( leadIn ) coverSpans.push({ start: segment.start, end: segment.start + leadIn.length + 1 });
    const activity = {
      kind, name: nameOf(segment.text, leads, segment.cast?.cast), raw: segment.text, index: -1,
      activation: segment.activation ? withoutIndex(segment.activation) : feature.activation,
      attack: feature.attack, range: feature.range, target: feature.target, template: feature.template,
      damage, save: feature.save, heal: segment.heal?.part ?? null, cast: segment.cast?.cast ?? null,
      consume: segment.consume?.consume ?? null, extraDamage: extra[0] ?? null, origin: "rules"
    };
    segment.activity = activity;
    activities.push(activity);
    // A variant acts and consumes like the activity it derives from ("expend 1 charge to ... Hit: 7 (2d6) fire
    // damage, plus 4 (1d8) fire damage if the target is undead": both activities expend the charge)
    for ( const variant of feature.variants ) {
      activities.push({
        ...variant, name: variantName(activity.name || title, variant.condition),
        activation: activity.activation, consume: activity.consume
      });
    }
  }

  // A weapon always has its attack; the extra damage of the text rides on it
  if ( details.weapon && !activities.some(activity => activity.attack) ) {
    const category = details.weapon.category;
    const type = category ? (category.endsWith("R") ? "ranged" : "melee") : null;
    activities.unshift({
      kind: "attack", name: "", raw: details.weapon.raw || fact.raw, index: -1, activation: null,
      attack: { type, classification: "weapon", bonus: null, raw: details.weapon.raw || fact.raw, origin: "rules" },
      range: null, target: null, template: null, damage: [], save: null, heal: null, cast: null, consume: null,
      extraDamage: null, origin: "rules"
    });
  }
  const attackActivity = activities.find(activity => activity.kind === "attack");
  if ( attackActivity ) {
    for ( const activity of activities ) {
      if ( activity === attackActivity || activity.condition || !activity.extraDamage ) continue;
      attackActivity.extraDamage ??= activity.extraDamage;
      activity.extraDamage = null;
    }
    // A conditional variant of damage alone ("deals an extra 2d6 Fire damage if...") is a variant of the weapon attack
    const attackVariants = [];
    for ( const activity of [...activities, ...orphanVariants] ) {
      if ( !activity.condition || activity.kind !== "damage" ) continue;
      const variant = {
        ...activity, kind: "attack", attack: attackActivity.attack, range: activity.range ?? attackActivity.range,
        activation: activity.activation ?? attackActivity.activation, consume: activity.consume ?? attackActivity.consume,
        name: variantName(attackActivity.name || title, activity.condition)
      };
      if ( activities.includes(activity) ) activities.splice(activities.indexOf(activity), 1);
      attackVariants.push(variant);
    }
    activities.splice(activities.indexOf(attackActivity) + 1, 0, ...attackVariants);
  } else {
    activities.push(...orphanVariants.map(variant => ({ ...variant, name: variantName(title, variant.condition) })));
  }
  activities.forEach((activity, index) => { activity.index = index; });
  for ( const segment of segments ) for ( const effect of segment.effects ) effect.activity = segment.activity?.index ?? null;

  // Item-level feature (uses, recharge...) from what is left of the text
  const feature = parseFeature(title, cutSpans(text, [...itemSpans, ...activitySpans, ...coverSpans]), parseOpts);
  for ( const entry of feature.unrecognized ) {
    const at = text.indexOf(entry.text);
    if ( at >= 0 ) entry.index = at;
  }
  const extraRaw = new Set(activities.flatMap(activity => activity.extraDamage ? [activity.extraDamage.raw] : []));
  feature.damage = feature.damage.filter(part => !extraRaw.has(part.raw));
  const plan = {
    ...feature, name: title, itemKind: fact.kind, details,
    effects: effects.map(effect => Object.fromEntries(Object.entries(effect).filter(([key]) => key !== "sentence"))), activities
  };
  plan.notes = [...feature.notes, ...notes, ...meta.notes, ...weapon.notes, ...armor.notes, ...consumable.notes]
    .filter((note, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(note)) === index);
  plan.ambiguous = [...feature.ambiguous, ...ambiguous, ...magic.ambiguous, ...meta.ambiguous, ...weapon.ambiguous,
    ...armor.ambiguous, ...consumable.ambiguous]
    .filter((note, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(note)) === index);
  plan.variants = [];   // the conditional variants of an item are ActivityPlans of `activities`
  return plan;
}
