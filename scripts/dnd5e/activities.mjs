import { isValidKey } from "./keys.mjs";

/**
 * Translation of a FeaturePlan / ItemPlan into dnd5e 6 activity sources (attack, save, damage, heal, cast, utility).
 * Pure: no Foundry global. Never invents a key: values missing from `keys` are dropped.
 */

const LEGRES_CONDITION = { en: "fails a saving throw", fr: "rate un jet de sauvegarde" };
const FLAG_SCOPE = "dnd5e-text-parser";

/**
 * Translate a damage part of the plan into a dnd5e `DamageData` source.
 * @param {object} part   DamagePart of the plan.
 * @param {object} [keys]
 * @returns {object}
 */
export function toDamagePart(part, keys) {
  const types = part.type && isValidKey(keys, "damageTypes", part.type) ? [part.type] : [];
  return {
    number: part.number ?? null,
    denomination: part.denomination ?? null,
    bonus: part.bonus ?? "",
    types,
    custom: { enabled: false, formula: "" },
    scaling: { number: 1 }
  };
}

/**
 * Activation of an activity.
 * @param {object|null} activation  Plan activation.
 * @param {object} [keys]
 * @returns {object|null}
 */
function buildActivation(activation, keys) {
  if ( !activation?.type || !isValidKey(keys, "activityActivationTypes", activation.type) ) return null;
  const result = { type: activation.type, condition: "", override: false };
  if ( activation.type === "legendary" ) result.value = activation.cost ?? 1;
  else if ( Number.isInteger(activation.cost) ) result.value = activation.cost;
  return result;
}

/**
 * Range of an activity (feet). Melee attacks use the reach, the others the range.
 * @param {object|null} range
 * @param {object|null} attack
 * @returns {object|null}
 */
function buildRange(range, attack) {
  if ( !range ) return null;
  const value = attack?.type === "melee" ? (range.reach ?? range.value) : (range.value ?? range.reach);
  if ( value === null || value === undefined ) return null;
  return { value: String(value), units: "ft", special: "", override: true };
}

/**
 * Target (affected creatures) and template of an activity.
 * @param {object} plan
 * @param {object} [keys]
 * @param {{affects: boolean, template: boolean}} include
 * @returns {object|null}
 */
function buildTarget(plan, keys, include) {
  const target = {};
  if ( include.affects && plan.target?.count ) {
    const type = plan.target.type ?? "";
    if ( !type || isValidKey(keys, "individualTargetTypes", type) ) {
      target.affects = { count: String(plan.target.count), type, choice: false, special: "" };
    }
  }
  const template = plan.template;
  if ( include.template && template?.type && isValidKey(keys, "areaTargetTypes", template.type) ) {
    target.template = { type: template.type, size: String(template.size), units: "ft" };
    if ( template.width ) target.template.width = String(template.width);
    if ( template.height ) target.template.height = String(template.height);
  }
  if ( !Object.keys(target).length ) return null;
  return { ...target, override: true, prompt: true };
}

/**
 * Create the base of an activity.
 * @param {string} type
 * @param {object} plan
 * @param {object} context
 * @param {boolean} [consume=true]  Add the `itemUses` consumption target (only the first activity of a feature does).
 * @returns {object}
 */
function baseActivity(type, plan, { keys, idGen }, consume = true) {
  const activity = { _id: idGen(), type };
  const activation = buildActivation(plan.activation, keys);
  if ( activation ) activity.activation = activation;
  if ( consume && (plan.uses || plan.recharge) ) {
    activity.consumption = { targets: [{ type: "itemUses", target: "", value: "1", scaling: {} }] };
  }
  return activity;
}

/** Consumption of `amount` item uses. */
const itemUses = amount => ({ targets: [{ type: "itemUses", target: "", value: String(amount), scaling: {} }] });

/**
 * Activities of a feature-like plan (a FeaturePlan or one ActivityPlan): attack, save, damage.
 * @param {object} plan
 * @param {object} context  `{ keys, idGen }`.
 * @param {{item?: object, consume?: boolean}} [options]
 * @returns {object[]}
 */
function featureActivities(plan, context, { item, consume = true } = {}) {
  const { keys } = context;
  const isWeapon = item?.type === "weapon";
  const activities = [];

  if ( plan.attack && (plan.attack.type || plan.attack.classification) ) {
    const attack = baseActivity("attack", plan, context, consume);
    const flat = Number.isFinite(plan.attack.bonus);
    attack.attack = {
      ability: "",
      bonus: flat ? String(plan.attack.bonus) : "",
      flat,
      type: { value: plan.attack.type ?? "", classification: plan.attack.classification ?? "" }
    };
    const parts = (plan.damage ?? []).map(part => toDamagePart(part, keys));
    attack.damage = { includeBase: !parts.length, parts };
    if ( plan.extraDamage ) attack.damage.parts.push(toDamagePart(plan.extraDamage, keys));
    activities.push(attack);
  }

  if ( plan.save?.ability && isValidKey(keys, "abilities", plan.save.ability) ) {
    const save = baseActivity("save", plan, context, consume && !activities.length);
    save.save = { ability: [plan.save.ability], dc: { calculation: "", formula: plan.save.dc != null ? String(plan.save.dc) : (plan.save.dcFormula ?? "") } };
    save.damage = {
      onSave: plan.save.onSave ?? "none",
      parts: (plan.save.damage ?? []).map(part => toDamagePart(part, keys))
    };
    if ( plan.extraDamage && !plan.attack ) save.damage.parts.push(toDamagePart(plan.extraDamage, keys));
    activities.push(save);
  }

  // Damage without an attack: alone, or next to a save when it is not the save's damage (ongoing damage of a condition)
  const standalone = !activities.length;
  if ( !activities.some(activity => activity.type === "attack") && (plan.damage?.length || (standalone && plan.extraDamage)) ) {
    const damage = baseActivity("damage", plan, context, consume && standalone);
    const parts = [...(plan.damage ?? []), ...(standalone && plan.extraDamage ? [plan.extraDamage] : [])];
    damage.damage = { parts: parts.map(part => toDamagePart(part, keys)) };
    activities.push(damage);
  }

  if ( activities.length ) {
    // Range and affected creatures go on the first activity, the area on the save (else the first).
    const first = activities[0];
    const saveActivity = activities.find(a => a.type === "save") ?? first;
    if ( !isWeapon || first.type !== "attack" ) {
      const range = buildRange(plan.range, plan.attack);
      if ( range ) first.range = range;
    }
    for ( const activity of activities ) {
      const target = buildTarget(plan, keys, {
        affects: activity === first,
        template: activity === saveActivity
      });
      if ( target ) activity.target = target;
    }
  }
  return activities;
}

/**
 * Activities of one ActivityPlan of an item.
 * @param {object} plan       ActivityPlan.
 * @param {object} context    `{ keys, idGen }`.
 * @param {object} options
 * @returns {object[]}
 */
function itemActivity(plan, context, { item, resolveSpell, notes }) {
  const { keys, idGen } = context;
  if ( plan.cast ) {
    const uuid = resolveSpell?.(plan.cast.name) ?? null;
    if ( !uuid ) {
      notes.push({ key: "dnd5e-text-parser.Note.SpellNotFound", data: { name: plan.cast.name } });
      return [];
    }
    const cast = { _id: idGen(), type: "cast", spell: { uuid } };
    const activation = buildActivation(plan.activation, keys);
    if ( activation ) cast.activation = activation;
    const { dc, attack, level } = plan.cast;
    if ( Number.isFinite(level) ) cast.spell.level = level;
    if ( Number.isFinite(dc) || Number.isFinite(attack) ) {
      cast.spell.challenge = { override: true };
      if ( Number.isFinite(dc) ) cast.spell.challenge.save = String(dc);
      if ( Number.isFinite(attack) ) cast.spell.challenge.attack = String(attack);
    }
    return [cast];
  }
  if ( plan.heal ) {
    const heal = { _id: idGen(), type: "heal" };
    const activation = buildActivation(plan.activation, keys);
    if ( activation ) heal.activation = activation;
    heal.healing = toDamagePart({ ...plan.heal, type: null }, keys);
    if ( isValidKey(keys, "healingTypes", "healing") ) heal.healing.types = ["healing"];
    const range = buildRange(plan.range, null);
    if ( range ) heal.range = range;
    const target = buildTarget(plan, keys, { affects: true, template: false });
    if ( target ) heal.target = target;
    return [heal];
  }
  const activities = featureActivities(plan, context, { item, consume: false });
  if ( !activities.length ) {
    const utility = { _id: idGen(), type: "utility" };
    const activation = buildActivation(plan.activation, keys);
    if ( activation ) utility.activation = activation;
    activities.push(utility);
  }
  return activities;
}

/**
 * Translate a plan into activity sources.
 *
 * FeaturePlan:
 * - `attack` plan -> attack activity (flat bonus, damage of the hit, `damage.includeBase = false` when written).
 * - `save` plan -> save activity (fixed DC: `calculation: ""` + `formula`); also created next to an attack.
 * - damage alone (no attack, no save) -> damage activity; `damage` next to a `save` (ongoing damage of a condition,
 *   never the save's own damage) -> a damage activity after the save activity.
 * - `legendaryResistance` -> utility activity consuming `resources.legres`.
 * - uses / recharge -> an `itemUses` consumption target on the first activity only.
 * A `multiattack` plan, or a plan without any of these facts, gives no activity.
 *
 * ItemPlan with `activities` (see `parseItem`): one or more activities per ActivityPlan, in order: `attack`
 * (flat bonus only when the text states one; the extra damage of the text is a damage part), `save`, `damage`,
 * `heal`, `cast` (needs `resolveSpell`), `utility`. `consume` gives an `itemUses` consumption target on the first
 * activity of that ActivityPlan; without any explicit `consume`, an item with limited uses (uses, recharge,
 * charges) consumes 1 use on its first activity. A scroll or potion without charges consumes nothing here.
 *
 * @param {object} plan                   FeaturePlan or ItemPlan.
 * @param {object} context
 * @param {object} [context.keys]         Valid keys (see `keysFromConfig`).
 * @param {function(): string} context.idGen  Generator of new activity ids.
 * @param {{type?: string}} [context.item]    Target item (a weapon takes its range from the item).
 * @param {"en"|"fr"} [context.lang]      Language of generated text (legendary resistance condition).
 * @param {function(string): (string|null)} [context.resolveSpell]  Spell name -> UUID of a spell item, or null.
 *   Without it (or when it returns null) a `cast` ActivityPlan gives no activity and a note.
 * @param {object[]} [context.effects]    Result of `toEffects`: the `_id` of the effects of an activity are listed
 *   in its `effects`.
 * @param {object[]} [context.notes]      Receives the descriptors of what could not be translated (also available
 *   on the returned array as a non-enumerable `notes` property).
 * @returns {object[]}
 */
export function toActivities(plan, { keys, idGen, item, lang = "en", resolveSpell, effects, notes = [] } = {}) {
  const result = [];
  Object.defineProperty(result, "notes", { value: notes, enumerable: false });
  if ( !plan || plan.skip ) return result;
  const context = { keys, idGen };

  if ( plan.activities?.length ) {
    const consumable = plan.details?.consumable;
    const limited = Boolean(plan.uses || plan.recharge || consumable?.charges || plan.details?.charges);
    const explicit = plan.activities.some(activity => activity.consume || activity.cast?.charges);
    let defaulted = false;
    for ( const activityPlan of plan.activities ) {
      const group = itemActivity(activityPlan, context, { item, resolveSpell, notes });
      if ( !group.length ) continue;
      const first = group[0];
      const amount = activityPlan.consume?.amount ?? activityPlan.cast?.charges ?? null;
      if ( amount ) first.consumption = itemUses(amount);
      else if ( limited && !explicit && !defaulted ) { first.consumption = itemUses(1); defaulted = true; }
      if ( activityPlan.name ) first.name = activityPlan.name;
      const linked = (effects ?? []).filter(effect => effect.flags?.[FLAG_SCOPE]?.activity === activityPlan.index);
      if ( linked.length ) first.effects = linked.map(effect => ({ _id: effect._id }));
      result.push(...group);
    }
    return result;
  }

  result.push(...featureActivities(plan, context, { item }));

  if ( plan.legendaryResistance ) {
    const resistance = { _id: idGen(), type: "utility" };
    resistance.activation = { type: "special", condition: LEGRES_CONDITION[lang] ?? LEGRES_CONDITION.en, override: false };
    resistance.consumption = {
      targets: [{ type: "attribute", target: "resources.legres.value", value: "1", scaling: {} }]
    };
    result.push(resistance);
  }
  return result;
}
