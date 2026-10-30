/**
 * Valid dnd5e keys, built from a `CONFIG.DND5E` object passed as a parameter (pure: no Foundry global).
 * Each entry is a Set of keys. A parser or translator only emits keys found in these sets.
 */

/** Keys of `CONFIG.DND5E` whose own keys (or Set members) are copied as-is. */
const SIMPLE = [
  "abilities", "skills", "damageTypes", "conditionTypes", "areaTargetTypes", "individualTargetTypes",
  "activityActivationTypes", "activityTypes", "limitedUsePeriods", "itemRarity", "attunementTypes",
  "weaponTypes", "weaponMasteries", "armorTypes", "consumableTypes", "currencies", "movementTypes",
  "spellcasting", "weaponIds", "armorIds", "healingTypes", "senses"
];

/**
 * Keys of `CONFIG.DND5E` read only when the config has them (an older snapshot without them keeps accepting every
 * key for these sets, as `isValidKey` does for a missing set). `languages` is a tree (`standard.children.common`,
 * `exotic.children.primordial.children.aquan`): every leaf key is kept.
 */
const OPTIONAL = ["actorSizes", "creatureTypes", "languages"];

/** `validProperties` groups kept, keyed by item type. */
const PROPERTY_GROUPS = ["weapon", "equipment", "consumable", "feat"];

/**
 * Keys of a `CONFIG.DND5E.languages`-like tree (categories with `children`), or of a flat table / list.
 * @param {*} value
 * @returns {Set<string>}
 */
function toLeafKeySet(value) {
  if ( !value || Array.isArray(value) || value instanceof Set || value instanceof Map ) return toKeySet(value);
  const keys = new Set();
  for ( const [key, entry] of Object.entries(value) ) {
    if ( entry && typeof entry === "object" && entry.children && typeof entry.children === "object" ) {
      for ( const leaf of toLeafKeySet(entry.children) ) keys.add(leaf);
      // "standard" and "exotic" are categories only (`selectable: false`); "primordial" is a language too
      if ( entry.selectable !== false ) keys.add(key);
    }
    else keys.add(key);
  }
  return keys;
}

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
  for ( const name of OPTIONAL ) if ( config[name] !== undefined ) keys[name] = toLeafKeySet(config[name]);
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

/**
 * JSON-safe snapshot of the valid keys of a `CONFIG.DND5E` object (each set as a sorted array). `keysFromConfig`
 * accepts it back, so tests can run without Foundry: save `JSON.stringify(keysSnapshot(CONFIG.DND5E))` once from a
 * running world, then `keysFromConfig(JSON.parse(text))` in Node. `keysFromConfig(keysSnapshot(c))` equals
 * `keysFromConfig(c)`.
 * @param {object} dnd5eConfig  `CONFIG.DND5E`.
 * @returns {Record<string, string[]> & {validProperties: Record<string, string[]>}}
 */
export function keysSnapshot(dnd5eConfig) {
  const keys = keysFromConfig(dnd5eConfig);
  const snapshot = {};
  for ( const name of SIMPLE ) snapshot[name] = [...keys[name]].sort();
  for ( const name of OPTIONAL ) if ( keys[name] ) snapshot[name] = [...keys[name]].sort();
  snapshot.validProperties = {};
  for ( const group of PROPERTY_GROUPS ) snapshot.validProperties[group] = [...keys.validProperties[group]].sort();
  return snapshot;
}
