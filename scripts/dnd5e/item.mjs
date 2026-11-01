import { isValidKey } from "./keys.mjs";
import { toDamagePart } from "./activities.mjs";

/**
 * Translation of a FeaturePlan / ItemPlan into a partial dnd5e 6 item `system` source.
 * Pure: no Foundry global. Only keys found in `keys` are written.
 */

/**
 * Item uses (`system.uses`) from uses, recharge and consumable charges.
 * @param {object} plan
 * @param {object} [keys]
 * @returns {object|null}
 */
function buildUses(plan, keys) {
  if ( plan.legendaryResistance ) return null;   // goes to the actor (resources.legres)
  const recovery = [];
  let max = null;
  const charges = plan.details?.consumable?.charges ?? plan.details?.charges;
  if ( plan.uses && isValidKey(keys, "limitedUsePeriods", plan.uses.period) ) {
    max = plan.uses.max;
    recovery.push(plan.uses.recoverFormula
      ? { period: plan.uses.period, type: "formula", formula: plan.uses.recoverFormula }
      : { period: plan.uses.period, type: "recoverAll" });
  } else if ( charges?.period && isValidKey(keys, "limitedUsePeriods", charges.period) ) {
    max = charges.max;
    recovery.push(charges.formula
      ? { period: charges.period, type: "formula", formula: charges.formula }
      : { period: charges.period, type: "recoverAll" });
  } else if ( charges ) max = charges.max;
  // "recharge" is not a `limitedUsePeriods` key in dnd5e 6: it is a fixed period handled by `UsesField`
  // (data/shared/uses-field.mjs, `recovery.period === "recharge"`, formula = minimum d6 result, type recoverAll)
  if ( plan.recharge && Number.isFinite(plan.recharge.min) ) {
    max ??= 1;
    recovery.push({ period: "recharge", type: "recoverAll", formula: String(plan.recharge.min) });
  }
  // No uses are invented for a consumable without charges (scroll, potion): dnd5e handles their consumption by type.
  // `autoDestroy` only makes sense with charges ("the wand crumbles into ashes" on its last charge).
  if ( max === null ) return null;
  const uses = { max: String(max), recovery };
  if ( plan.details?.consumable?.destroyOnEmpty ) uses.autoDestroy = true;
  return uses;
}

/**
 * Weapon range (feet).
 * @param {object} range
 * @returns {object|null}
 */
function buildWeaponRange(range) {
  const result = {};
  for ( const key of ["reach", "value", "long"] ) {
    if ( Number.isFinite(range?.[key]) ) result[key] = range[key];
  }
  if ( !Object.keys(result).length ) return null;
  result.units = "ft";
  return result;
}

/**
 * Weapon details.
 * @param {object} weapon
 * @param {object} keys
 * @param {Set<string>} properties  Receives the weapon properties.
 * @returns {object}
 */
function buildWeapon(weapon, keys, properties) {
  const system = {};
  const type = {};
  if ( weapon.category && isValidKey(keys, "weaponTypes", weapon.category) ) type.value = weapon.category;
  if ( weapon.baseItem && isValidKey(keys, "weaponIds", weapon.baseItem) ) type.baseItem = weapon.baseItem;
  if ( Object.keys(type).length ) system.type = type;
  for ( const property of weapon.properties ?? [] ) {
    if ( keys?.validProperties?.weapon && !keys.validProperties.weapon.has(property) ) continue;
    properties.add(property);
  }
  const damage = {};
  if ( weapon.base ) damage.base = toDamagePart(weapon.base, keys);
  if ( weapon.versatile ) damage.versatile = toDamagePart(weapon.versatile, keys);
  if ( Object.keys(damage).length ) system.damage = damage;
  if ( weapon.magicalBonus ) system.magicalBonus = String(weapon.magicalBonus);
  if ( weapon.mastery && isValidKey(keys, "weaponMasteries", weapon.mastery) ) system.mastery = weapon.mastery;
  return system;
}

/**
 * Armor details.
 * @param {object} armor
 * @param {object} keys
 * @param {Set<string>} properties  Receives the armor properties.
 * @returns {object}
 */
function buildArmor(armor, keys, properties) {
  const system = {};
  if ( armor.type && isValidKey(keys, "armorTypes", armor.type) ) system.type = { value: armor.type };
  const value = {};
  if ( Number.isFinite(armor.ac) ) value.value = armor.ac;
  if ( Number.isFinite(armor.dexCap) ) value.dex = armor.dexCap;
  else if ( armor.type === "heavy" ) value.dex = 0;
  if ( armor.magicalBonus ) value.magicalBonus = String(armor.magicalBonus);
  if ( Object.keys(value).length ) system.armor = value;
  if ( Number.isFinite(armor.strength) ) system.strength = armor.strength;
  if ( armor.stealthDisadvantage ) properties.add("stealthDisadvantage");
  return system;
}

/**
 * Translate a plan into a partial `system` source of an item.
 * @param {object} plan                      FeaturePlan or ItemPlan.
 * @param {object} [context]
 * @param {object} [context.keys]            Valid keys (see `keysFromConfig`).
 * @param {{type?: string}} [context.item]   Target item (a weapon takes the plan range in `system.range`).
 * @returns {object}                         Partial `system` (empty object when nothing is known).
 */
export function toItemPatch(plan, { keys, item } = {}) {
  if ( !plan || plan.skip ) return {};
  const system = {};
  const properties = new Set();
  const details = plan.details ?? {};

  const uses = buildUses(plan, keys);
  if ( uses ) system.uses = uses;
  if ( plan.legendaryResistance ) system.identifier = "legendary-resistance";

  if ( (item?.type === "weapon") || details.weapon ) {
    const range = buildWeaponRange(plan.range);
    if ( range ) system.range = range;
  }
  if ( details.weapon ) Object.assign(system, buildWeapon(details.weapon, keys, properties));
  if ( details.armor ) Object.assign(system, buildArmor(details.armor, keys, properties));

  const consumableType = details.consumable?.type;
  if ( consumableType && isValidKey(keys, "consumableTypes", consumableType) ) {
    system.type = { value: consumableType };
  }

  // dnd5e 5.3.3: `rarity` is a single string (data/item/templates/physical-item.mjs)
  if ( details.rarity && isValidKey(keys, "itemRarity", details.rarity) ) system.rarity = details.rarity;
  if ( details.attunement && isValidKey(keys, "attunementTypes", details.attunement) ) {
    system.attunement = details.attunement;
  }
  if ( details.weight ) system.weight = { value: details.weight.value, units: details.weight.units ?? "lb" };
  if ( details.price && isValidKey(keys, "currencies", details.price.denomination) ) {
    system.price = { value: details.price.value, denomination: details.price.denomination };
  }
  if ( details.magical ) {
    const group = item?.type === "weapon" || details.weapon ? "weapon"
      : item?.type === "consumable" || details.consumable ? "consumable" : "equipment";
    const valid = keys?.validProperties?.[group];
    if ( !valid || valid.has("mgc") ) properties.add("mgc");
  }

  if ( properties.size ) system.properties = Array.from(properties);
  return system;
}
