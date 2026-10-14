/**
 * "Fill empty fields only" merge. Pure: no Foundry global.
 */

/**
 * Is a value empty? `undefined`, `null`, `""`, `[]` and an object without key are empty.
 * `0` and `false` are values.
 * @param {*} value
 * @returns {boolean}
 */
export function isEmpty(value) {
  if ( value === undefined || value === null || value === "" ) return true;
  if ( Array.isArray(value) ) return value.length === 0;
  if ( value instanceof Set || value instanceof Map ) return value.size === 0;
  if ( typeof value === "object" ) return Object.keys(value).length === 0;
  return false;
}

/**
 * Is an activity source an "empty utility" (convertible into attack, save or damage)?
 * `activation` and `name` may be filled: they do not count.
 * @param {object} activity
 * @returns {boolean}
 */
export function isEmptyUtility(activity) {
  if ( !activity || activity.type !== "utility" ) return false;
  return [
    activity.roll?.formula, activity.effects, activity.consumption?.targets, activity.uses?.max,
    activity.range?.value, activity.target?.template?.type, activity.target?.affects?.type,
    activity.target?.affects?.count
  ].every(isEmpty);
}

const isPlainObject = value => (value !== null) && (typeof value === "object")
  && !Array.isArray(value) && !(value instanceof Set) && !(value instanceof Map);

const clone = value => {
  if ( Array.isArray(value) ) return value.map(clone);
  if ( isPlainObject(value) ) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};

/**
 * Copy into `target` every leaf of `patch` whose counterpart in `target` is empty. A non-empty leaf of `target`
 * is never modified. Nested objects are merged leaf by leaf; arrays and Sets are leaves.
 * Empty values of `patch` are ignored. `target` is modified in place.
 * @param {object} target                  Object to complete.
 * @param {object} patch                   Values to add.
 * @param {object} [options]
 * @param {string} [options.path]          Path prefix of the reported fields.
 * @param {string[]} [options.zeroIsEmpty] Full paths where `0` counts as empty.
 * @returns {{path: string, value: *}[]}   Filled fields (dotted path and value).
 */
export function mergeMissing(target, patch, { path = "", zeroIsEmpty = [] } = {}) {
  const filled = [];
  if ( !isPlainObject(target) || !isPlainObject(patch) ) return filled;
  for ( const [key, value] of Object.entries(patch) ) {
    const fullPath = path ? `${path}.${key}` : key;
    if ( isPlainObject(value) ) {
      if ( isEmpty(value) ) continue;
      const created = !isPlainObject(target[key]) && isEmpty(target[key]);
      if ( created ) target[key] = {};
      if ( !isPlainObject(target[key]) ) continue;
      const sub = mergeMissing(target[key], value, { path: fullPath, zeroIsEmpty });
      filled.push(...sub);
      if ( created && isEmpty(target[key]) ) delete target[key];
      continue;
    }
    if ( isEmpty(value) ) continue;
    const current = target[key];
    if ( isEmpty(current) || ((current === 0) && zeroIsEmpty.includes(fullPath)) ) {
      target[key] = clone(value);
      filled.push({ path: fullPath, value: clone(value) });
    }
  }
  return filled;
}
