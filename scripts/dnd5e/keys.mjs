/**
 * Valid dnd5e keys, built from a `CONFIG.DND5E` object passed as a parameter (pure: no Foundry global).
 * Each entry is a Set of keys. A parser or translator only emits keys found in these sets.
 */

/** Keys of `CONFIG.DND5E` whose own keys (or Set members) are copied as-is. */
const SIMPLE = [
  "abilities", "skills", "damageTypes", "conditionTypes", "areaTargetTypes", "individualTargetTypes",
  "activityActivationTypes", "activityTypes", "limitedUsePeriods", "itemRarity", "attunementTypes",
  "weaponTypes", "weaponMasteries", "armorTypes", "consumableTypes", "currencies", "movementTypes",
  "spellcasting", "weaponIds", "armorIds"
];

/** `validProperties` groups kept, keyed by item type. */
const PROPERTY_GROUPS = ["weapon", "equipment", "consumable", "feat"];

/**
 * @param {*} value  Object, Map, Set or array.
 * @returns {Set<string>}
 */
function toKeySet(value) {
  if ( !value ) return new Set();
  if ( value instanceof Set ) return new Set(value);
  if ( value instanceof Map ) return new Set(value.keys());
  if ( Array.isArray(value) ) return new Set(value);
  return new Set(Object.keys(value));
}

/**
 * Build the sets of valid keys.
 * @param {object} dnd5eConfig  `CONFIG.DND5E`.
 * @returns {Record<string, Set<string>> & {validProperties: Record<string, Set<string>>}}
 */
export function keysFromConfig(dnd5eConfig) {
  const config = dnd5eConfig ?? {};
  const keys = {};
  for ( const name of SIMPLE ) keys[name] = toKeySet(config[name]);
  keys.validProperties = {};
  for ( const group of PROPERTY_GROUPS ) keys.validProperties[group] = toKeySet(config.validProperties?.[group]);
  return keys;
}

/**
 * Is `key` valid for the set `keys[name]`? Without a `keys` object, or without that set, every key is accepted
 * (no validation); an existing but empty set rejects everything.
 * @param {object|undefined} keys
 * @param {string} name
 * @param {string} key
 * @returns {boolean}
 */
export function isValidKey(keys, name, key) {
  const set = keys?.[name];
  if ( !set ) return true;
  return set.has(key);
}
