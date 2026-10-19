import { effectGroupKey } from "./effects.mjs";
import { formulaOf } from "../parse/recognizers/damage.mjs";

export { formulaOf };

/**
 * Neutral descriptors `{ key, data, group, raw, origin, paths }` of a plan or of a list of changes, for summaries
 * and previews. `key` is a localization key of this module (`lang/*.json`); the consumer localizes it with `data`.
 * - `group`: `"details"` | `"activities"` | `"effects"`, or `null` for notes and unrecognized sentences.
 * - `raw`: the source passage of the fact (the sentence or phrase it was read from; `""` when unknown).
 * - `origin`: `"rules"` | `"fallback"`.
 * - `paths`: what the fact produces: `system.*` paths for details, `activities.<n>` (index in the array returned
 *   by `toActivities(plan)`, assuming every spell is resolved) and `effects.<n>` (index in the array returned by
 *   `toEffects(plan)`).
 * Pure: no Foundry global.
 */

const PREFIX = "dnd5e-text-parser.";

/** Every key `describe` can emit itself (all exist in `lang/en.json` and `lang/fr.json`). */
export const DESCRIBE_KEYS = Object.freeze([
  "Describe.Attack", "Describe.Range", "Describe.Target", "Describe.Damage", "Describe.Save", "Describe.Template",
  "Describe.Uses", "Describe.Recharge", "Describe.LegendaryResistance", "Describe.Activation", "Describe.Skipped",
  "Describe.Weapon", "Describe.Armor", "Describe.Consumable", "Describe.Charges", "Describe.Rarity", "Describe.Attunement",
  "Describe.Weight", "Describe.Price", "Describe.Effect", "Describe.Field", "Describe.Fallback",
  "Describe.Activity", "Describe.Heal", "Describe.Cast", "Describe.Consume", "Describe.ExtraDamage",
  "Note.Unrecognized", "Note.Flavor"
].map(key => PREFIX + key));

/**
 * Build a descriptor; a fact proposed by the fallback resolver is flagged with `data.origin = "fallback"`.
 * @param {string} name
 * @param {object} data
 * @param {object|null} fact
 * @param {{group?: string|null, paths?: string[], raw?: string}} [options]
 * @returns {object}
 */
function entry(name, data, fact, { group = null, paths = [], raw } = {}) {
  const origin = fact?.origin === "fallback" ? "fallback" : "rules";
  return {
    key: `${PREFIX}Describe.${name}`,
    data: origin === "fallback" ? { ...data, origin } : data,
    group, raw: raw ?? fact?.raw ?? "", origin, paths: [...paths]
  };
}

/** A note or ambiguity of the plan, as a descriptor without group. */
function note(descriptor) {
  const raw = Array.isArray(descriptor.data?.raw) ? descriptor.data.raw.join(" ") : (descriptor.data?.raw ?? descriptor.data?.text ?? "");
  return { ...descriptor, group: null, raw: String(raw), origin: descriptor.origin ?? "rules", paths: [] };
}

const damageEntry = (part, save, options, name = "Damage") => entry(name, {
  formula: formulaOf(part), type: part.type ?? "", raw: part.raw ?? "", save
}, part, options);

/** Number of activities `toActivities` makes for an ActivityPlan. */
function activityCount(activity) {
  if ( activity.cast || activity.heal ) return 1;
  const hasAttack = Boolean(activity.attack && (activity.attack.type || activity.attack.classification));
  const count = (hasAttack ? 1 : 0) + (activity.save?.ability ? 1 : 0) + (!hasAttack && activity.damage?.length ? 1 : 0);
  return count || 1;
}

const range = (from, count) => Array.from({ length: count }, (_, i) => `activities.${from + i}`);

/** Facts of a feature-like plan (FeaturePlan or ActivityPlan) as activity descriptors. */
function featureFacts(plan, paths, out, { rawOf = fact => fact?.raw } = {}) {
  const options = fact => ({ group: "activities", paths: paths.all, raw: rawOf(fact) });
  if ( plan.activation ) {
    out.push(entry("Activation", { type: plan.activation.type, cost: plan.activation.cost }, plan.activation, options(plan.activation)));
  }
  if ( plan.attack ) {
    out.push(entry("Attack", {
      type: plan.attack.type, classification: plan.attack.classification, bonus: plan.attack.bonus ?? ""
    }, plan.attack, { ...options(plan.attack), paths: paths.attack }));
  }
  if ( plan.range ) out.push(entry("Range", { ...plan.range }, plan.range, { ...options(plan.range), paths: paths.first }));
  if ( plan.target ) {
    out.push(entry("Target", { count: plan.target.count, type: plan.target.type }, plan.target, { ...options(plan.target), paths: paths.first }));
  }
  for ( const part of plan.damage ?? [] ) out.push(damageEntry(part, false, { ...options(part), paths: paths.attack.length ? paths.attack : paths.damage }));
  if ( plan.extraDamage ) {
    out.push(damageEntry(plan.extraDamage, false, { ...options(plan.extraDamage), paths: paths.attack.length ? paths.attack : paths.damage }, "ExtraDamage"));
  }
  if ( plan.save ) {
    out.push(entry("Save", { ability: plan.save.ability, dc: plan.save.dc, onSave: plan.save.onSave }, plan.save, { ...options(plan.save), paths: paths.save }));
    for ( const part of plan.save.damage ?? [] ) out.push(damageEntry(part, true, { ...options(part), paths: paths.save }));
  }
  if ( plan.template ) {
    out.push(entry("Template", { ...plan.template }, plan.template, { ...options(plan.template), paths: paths.save.length ? paths.save : paths.first }));
  }
}

/** Paths of the activities of a flat FeaturePlan (same layout as `toActivities`). */
function flatPaths(plan) {
  const attack = plan.attack && (plan.attack.type || plan.attack.classification);
  const save = plan.save?.ability;
  const damage = !attack && plan.damage?.length;
  let next = 0;
  const attackAt = attack ? next++ : -1;
  const saveAt = save ? next++ : -1;
  const damageAt = damage ? next++ : -1;
  const base = next;
  // One activity per conditional variant, after the base activities
  const variants = (plan.variants ?? []).map(variant => {
    const path = [`activities.${next++}`];
    return { all: path, first: path, attack: variant.kind === "attack" ? path : [], save: variant.kind === "save" ? path : [],
      damage: variant.kind === "damage" ? path : [] };
  });
  const legresAt = plan.legendaryResistance ? next++ : -1;
  const at = index => (index >= 0 ? [`activities.${index}`] : []);
  return {
    all: Array.from({ length: base }, (_, i) => `activities.${i}`),
    first: at([attackAt, saveAt, damageAt].some(i => i >= 0) ? 0 : -1),
    attack: at(attackAt), save: at(saveAt), damage: at(damageAt), legres: at(legresAt), variants
  };
}

/**
 * Describe a plan (FeaturePlan / ItemPlan) or a list of changes (`mergeMissing` result).
 * Notes and ambiguities of the plan are passed through as they are (with `group: null`); unrecognized sentences
 * become `dnd5e-text-parser.Note.Unrecognized`, the flavor text of an item `dnd5e-text-parser.Note.Flavor`.
 * @param {object|{path: string, value: *}[]} planOrChanges
 * @returns {{key: string, data: object, group: string|null, raw: string, origin: string, paths: string[]}[]}
 */
export function describe(planOrChanges) {
  if ( Array.isArray(planOrChanges) ) {
    return planOrChanges.map(({ path, value }) => entry("Field", { path, value }, null, { group: "details", paths: [path] }));
  }
  const plan = planOrChanges;
  const result = [];
  if ( !plan ) return result;
  if ( plan.skip ) result.push(entry("Skipped", { reason: plan.skip }, null, { raw: plan.skip }));

  if ( plan.activities?.length ) {
    let offset = 0;
    for ( const activity of plan.activities ) {
      const count = activityCount(activity);
      const all = range(offset, count);
      const hasAttack = activity.attack && (activity.attack.type || activity.attack.classification);
      const saveAt = activity.save?.ability ? (hasAttack ? 1 : 0) : -1;
      const damageAt = hasAttack ? 0 : (saveAt >= 0 ? 1 : 0);
      const paths = {
        all, first: all.slice(0, 1), attack: hasAttack ? all.slice(0, 1) : [],
        save: saveAt >= 0 ? all.slice(saveAt, saveAt + 1) : [], damage: all.slice(damageAt, damageAt + 1)
      };
      offset += count;
      result.push(entry("Activity", {
        kind: activity.kind, name: activity.name ?? "", ...(activity.condition ? { condition: activity.condition } : {})
      }, activity, { group: "activities", paths: all, raw: activity.raw }));
      featureFacts(activity, paths, result);
      const options = fact => ({ group: "activities", paths: all, raw: fact?.raw });
      if ( activity.heal ) result.push(damageEntry(activity.heal, false, options(activity.heal), "Heal"));
      if ( activity.cast ) {
        const { name, level, dc, attack, charges } = activity.cast;
        result.push(entry("Cast", { name, level, dc, attack, charges }, activity.cast, options(activity.cast)));
      }
      if ( activity.consume ) {
        result.push(entry("Consume", { amount: activity.consume.amount }, activity.consume, options(activity.consume)));
      }
    }
  } else {
    const paths = flatPaths(plan);
    featureFacts(plan, paths, result);
    // Conditional variants: one activity each, described like the activities of an item
    (plan.variants ?? []).forEach((variant, index) => {
      const own = paths.variants[index];
      result.push(entry("Activity", { kind: variant.kind, name: variant.name ?? "", condition: variant.condition }, variant, {
        group: "activities", paths: own.all, raw: variant.raw
      }));
      featureFacts(variant, own, result);
    });
  }

  // Item-level facts: uses, recharge and legendary resistance
  const flat = flatPaths(plan.activities?.length ? {} : plan);
  if ( plan.uses ) {
    result.push(entry("Uses", { max: plan.uses.max, period: plan.uses.period }, plan.uses, { group: "details", paths: ["system.uses"] }));
  }
  if ( plan.recharge ) {
    result.push(entry("Recharge", { min: plan.recharge.min }, plan.recharge, { group: "details", paths: ["system.uses"] }));
  }
  if ( plan.legendaryResistance ) {
    result.push(entry("LegendaryResistance", { count: plan.legendaryResistance }, null, {
      group: "activities", paths: ["system.identifier", ...flat.legres], raw: ""
    }));
  }

  const details = plan.details ?? {};
  const detail = (name, data, fact, paths) => result.push(entry(name, data, fact, { group: "details", paths }));
  if ( details.weapon ) {
    const w = details.weapon;
    const paths = [];
    if ( w.category || w.baseItem ) paths.push("system.type");
    if ( w.base || w.versatile ) paths.push("system.damage");
    if ( w.properties?.length ) paths.push("system.properties");
    if ( w.magicalBonus ) paths.push("system.magicalBonus");
    if ( w.mastery ) paths.push("system.mastery");
    if ( plan.range ) paths.push("system.range");
    detail("Weapon", {
      category: w.category, baseItem: w.baseItem, properties: [...(w.properties ?? [])],
      base: w.base ? formulaOf(w.base) : "", versatile: w.versatile ? formulaOf(w.versatile) : "",
      magicalBonus: w.magicalBonus, mastery: w.mastery
    }, w, paths);
  }
  if ( details.armor ) {
    const a = details.armor;
    const paths = [];
    if ( a.type ) paths.push("system.type");
    if ( a.ac !== null || a.dexCap !== null || a.magicalBonus ) paths.push("system.armor");
    if ( a.strength !== null ) paths.push("system.strength");
    if ( a.stealthDisadvantage ) paths.push("system.properties");
    detail("Armor", { type: a.type, ac: a.ac, dexCap: a.dexCap, strength: a.strength,
      stealthDisadvantage: a.stealthDisadvantage, magicalBonus: a.magicalBonus }, a, paths);
  }
  if ( details.consumable ) {
    const c = details.consumable;
    const paths = [];
    if ( c.type ) paths.push("system.type");
    if ( c.charges ) paths.push("system.uses");
    detail("Consumable", { type: c.type, charges: c.charges?.max ?? null }, c, paths);
  }
  if ( details.charges ) detail("Charges", { charges: details.charges.max }, details.charges, ["system.uses"]);
  if ( details.rarity ) detail("Rarity", { rarity: details.rarity }, null, ["system.rarities"]);
  if ( details.attunement ) {
    detail("Attunement", { attunement: details.attunement, condition: details.attunementCondition ?? "" }, null, ["system.attunement"]);
  }
  if ( details.weight ) detail("Weight", { value: details.weight.value, units: details.weight.units }, details.weight, ["system.weight"]);
  if ( details.price ) detail("Price", { value: details.price.value, denomination: details.price.denomination }, details.price, ["system.price"]);

  // Effects: index of the ActiveEffect `toEffects` makes for each effect
  const groups = new Map();
  for ( const effect of plan.effects ?? [] ) {
    const groupKey = effectGroupKey(effect);
    if ( !groups.has(groupKey) ) groups.set(groupKey, groups.size);
    result.push(entry("Effect", { kind: effect.kind, value: effect.value, scope: effect.scope }, effect, {
      group: "effects", paths: [`effects.${groups.get(groupKey)}`], raw: effect.raw
    }));
  }

  result.push(...(plan.notes ?? []).map(note), ...(plan.ambiguous ?? []).map(note));
  for ( const sentence of plan.unrecognized ?? [] ) {
    result.push({
      key: `${PREFIX}Note.Unrecognized`, data: { text: sentence.text }, group: null, raw: sentence.text,
      origin: "rules", paths: []
    });
  }
  // Flavor text of an item: not interpreted either, reported apart
  for ( const sentence of plan.flavor ?? [] ) {
    result.push({
      key: `${PREFIX}Note.Flavor`, data: { text: sentence.text }, group: null, raw: sentence.text,
      origin: "rules", paths: []
    });
  }
  return result;
}
