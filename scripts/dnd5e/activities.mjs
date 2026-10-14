import { isValidKey } from "./keys.mjs";

/**
 * Translation of a FeaturePlan into dnd5e 6 activity sources (attack, save, damage, utility).
 * Pure: no Foundry global. Never invents a key: values missing from `keys` are dropped.
 */

const LEGRES_CONDITION = { en: "fails a saving throw", fr: "rate un jet de sauvegarde" };

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
 * @returns {object}
 */
function baseActivity(type, plan, { keys, idGen }) {
  const activity = { _id: idGen(), type };
  const activation = buildActivation(plan.activation, keys);
  if ( activation ) activity.activation = activation;
  if ( plan.uses || plan.recharge ) {
    activity.consumption = { targets: [{ type: "itemUses", target: "", value: "1", scaling: {} }] };
  }
  return activity;
}

/**
 * Translate a FeaturePlan into activity sources.
 * - `attack` plan -> attack activity (flat bonus, damage of the hit, `damage.includeBase = false` when written).
 * - `save` plan -> save activity (fixed DC: `calculation: ""` + `formula`); also created next to an attack.
 * - damage alone (no attack, no save) -> damage activity.
 * - `legendaryResistance` -> utility activity consuming `resources.legres`.
 * A `multiattack` plan, or a plan without any of these facts, gives no activity.
 * @param {object} plan                   FeaturePlan.
 * @param {object} context
 * @param {object} [context.keys]         Valid keys (see `keysFromConfig`).
 * @param {function(): string} context.idGen  Generator of new activity ids.
 * @param {{type?: string}} [context.item]    Target item (a weapon takes its range from the item).
 * @param {"en"|"fr"} [context.lang]      Language of generated text (legendary resistance condition).
 * @returns {object[]}
 */
export function toActivities(plan, { keys, idGen, item, lang = "en" } = {}) {
  if ( !plan || plan.skip ) return [];
  const context = { keys, idGen };
  const isWeapon = item?.type === "weapon";
  const activities = [];

  if ( plan.attack && (plan.attack.type || plan.attack.classification) ) {
    const attack = baseActivity("attack", plan, context);
    attack.attack = {
      ability: "",
      bonus: String(plan.attack.bonus ?? 0),
      flat: true,
      type: { value: plan.attack.type ?? "", classification: plan.attack.classification ?? "" }
    };
    const parts = (plan.damage ?? []).map(part => toDamagePart(part, keys));
    attack.damage = { includeBase: !parts.length, parts };
    activities.push(attack);
  }

  if ( plan.save?.ability && isValidKey(keys, "abilities", plan.save.ability) ) {
    const save = baseActivity("save", plan, context);
    save.save = { ability: [plan.save.ability], dc: { calculation: "", formula: String(plan.save.dc) } };
    save.damage = {
      onSave: plan.save.onSave ?? "none",
      parts: (plan.save.damage ?? []).map(part => toDamagePart(part, keys))
    };
    activities.push(save);
  }

  if ( !activities.length && plan.damage?.length ) {
    const damage = baseActivity("damage", plan, context);
    damage.damage = { parts: plan.damage.map(part => toDamagePart(part, keys)) };
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

  if ( plan.legendaryResistance ) {
    const resistance = { _id: idGen(), type: "utility" };
    resistance.activation = { type: "special", condition: LEGRES_CONDITION[lang] ?? LEGRES_CONDITION.en, override: false };
    resistance.consumption = {
      targets: [{ type: "attribute", target: "resources.legres.value", value: "1", scaling: {} }]
    };
    activities.push(resistance);
  }

  return activities;
}
