import { isValidKey } from "./keys.mjs";
import { lookup } from "../parse/lexicon/index.mjs";

/**
 * Translation of the effects of an ItemPlan into dnd5e 5.3.3 / Foundry v13 `ActiveEffect` sources
 * (top-level `changes[]` with a numeric `mode` and a string `value`; actor paths of dnd5e 5.3.3: `system.bonuses.*`,
 * `abilities.<a>.bonuses.*`, `skills.<s>.bonuses.check`, `movement.<type>`).
 * Pure: no Foundry global.
 */

export const FLAG_SCOPE = "dnd5e-text-parser";

/**
 * Foundry v13 `CONST.ACTIVE_EFFECT_MODES`, by name (the library has no access to `CONST`).
 * @type {Readonly<{ custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 }>}
 */
export const CHANGE_MODES = Object.freeze({ custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 });

const ROLL_TYPES = { weapon: ["mwak", "rwak"], spell: ["msak", "rsak"] };
const ALL_ROLL_TYPES = ["mwak", "rwak", "msak", "rsak"];
const ALL_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
// `MovementField` of dnd5e 5.3.3 (data/shared/movement-field.mjs): the only speed fields; `jump` of
// `CONFIG.DND5E.movementTypes` has no field
const SPEED_FIELDS = ["walk", "burrow", "climb", "fly", "swim"];
// Physical damage bypasses (`CONFIG.DND5E.itemProperties` with `isPhysical`): magical, silvered, adamantine
const BYPASSES = new Set(["mgc", "sil", "ada"]);

// Seconds of each time unit (Foundry plural names and dnd5e singular names, as `recognizeDuration` and a consumer
// may give either; the trailing "s" is stripped before the lookup); `rounds` / `turns` are combat durations
const SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };

const change = (key, mode, value) => ({ key, mode: CHANGE_MODES[mode], value: String(value), priority: null });

/**
 * Ability keys an unscoped advantage / disadvantage spreads over: those of `keys.abilities` when known.
 * @param {object} [keys]
 * @returns {string[]}
 */
const abilitiesOf = keys => (keys?.abilities ? [...keys.abilities] : ALL_ABILITIES);

/**
 * Speed fields written by an unscoped speed multiplier: the `MovementField` fields present in `keys.movementTypes`.
 * @param {object} [keys]
 * @returns {string[]}
 */
const speedFieldsOf = keys => SPEED_FIELDS.filter(type => isValidKey(keys, "movementTypes", type));

/**
 * Foundry v13 `EffectDurationData` of a plan duration (`{ value, units }`, `until`): `rounds` / `turns` keep their
 * unit, time units become `seconds` (same table as dnd5e 5.3.3 `DurationField.getEffectDuration`); a duration bound
 * to a turn boundary (`until`: end / start of the next turn, no event expiry in v13) lasts one turn.
 * @param {{ value?: number, units?: string, until?: string }|null|undefined} duration
 * @returns {{ seconds?: number, rounds?: number, turns?: number }|null}  `null` when nothing can be written.
 */
export function toEffectDuration(duration) {
  if ( !duration || typeof duration !== "object" ) return null;
  if ( duration.until ) return { turns: 1 };
  const value = Number(duration.value);
  if ( !Number.isFinite(value) || value <= 0 ) return null;
  const unit = String(duration.units ?? "").toLowerCase().replace(/s$/, "");
  if ( unit === "round" ) return { rounds: value };
  if ( unit === "turn" ) return { turns: value };
  if ( Object.hasOwn(SECONDS, unit) ) return { seconds: value * SECONDS[unit] };
  return null;
}

/**
 * Roll types (`mwak`...) of an attack / damage scope: `weapon` / `spell` expand to their two roll types, a roll type
 * stands for itself. `null` for an unknown scope (`Object.hasOwn`: "constructor" or "toString" are not scopes).
 */
const rollTypesOf = scope => (Object.hasOwn(ROLL_TYPES, scope) ? ROLL_TYPES[scope]
  : ALL_ROLL_TYPES.includes(scope) ? [scope] : null);

/**
 * Changes of one plan effect.
 * @param {object} effect  ItemEffect.
 * @param {object} [keys]
 * @param {object[]} notes  Receives the descriptors of what could not be written.
 * @returns {object[]}
 */
function changesOf(effect, keys, notes) {
  const { kind, value, scope } = effect;
  const skip = () => { notes.push({ key: "dnd5e-text-parser.Note.EffectSkipped", data: { kind, scope: String(effect.against ?? scope ?? "") } }); return []; };
  // A scope is a key (string) or nothing: anything else cannot name a dnd5e path
  if ( scope != null && typeof scope !== "string" ) return skip();
  switch ( kind ) {
    case "ac":
      return [change("system.attributes.ac.bonus", "add", value)];
    case "attack": {
      // dnd5e 5.3.3 has no global attack bonus: `system.bonuses.<mwak|rwak|msak|rsak>.attack` (creature.mjs)
      const rolls = scope ? rollTypesOf(scope) : ALL_ROLL_TYPES;
      return rolls ? rolls.map(roll => change(`system.bonuses.${roll}.attack`, "add", value)) : skip();
    }
    case "damage": {
      const rolls = scope ? rollTypesOf(scope) : ALL_ROLL_TYPES;
      return rolls ? rolls.map(roll => change(`system.bonuses.${roll}.damage`, "add", value)) : skip();
    }
    case "save":
    case "check": {
      // A bonus limited to a skill ("+5 bonus to Wisdom (Survival) checks") goes to that skill only
      if ( kind === "check" && effect.on === "skill" ) {
        return scope && isValidKey(keys, "skills", scope) ? [change(`system.skills.${scope}.bonuses.check`, "add", value)] : skip();
      }
      if ( scope && !isValidKey(keys, "abilities", scope) ) return skip();
      // dnd5e 5.3.3: `abilities.<a>.bonuses.check/save` (common.mjs), `bonuses.abilities.check/save` for all of them
      const key = scope ? `system.abilities.${scope}.bonuses.${kind}` : `system.bonuses.abilities.${kind}`;
      return [change(key, "add", value)];
    }
    case "resistance":
    case "vulnerability":
    case "immunity": {
      const isDamage = lookup("damage", scope) === scope && isValidKey(keys, "damageTypes", scope);
      const isCondition = !isDamage && lookup("conditions", scope) === scope && isValidKey(keys, "conditionTypes", scope);
      if ( !isDamage && !(isCondition && kind === "immunity") ) return skip();
      const trait = kind === "resistance" ? "dr" : kind === "vulnerability" ? "dv" : (isDamage ? "di" : "ci");
      return [change(`system.traits.${trait}.value`, "add", scope)];
    }
    case "advantage":
    case "disadvantage": {
      // "advantage on saving throws against being frightened": dnd5e has no key scoped to a condition or damage type
      if ( effect.against ) return skip();
      const mode = kind === "advantage" ? 1 : -1;
      if ( effect.on === "skill" ) {
        return scope && isValidKey(keys, "skills", scope) ? [change(`system.skills.${scope}.roll.mode`, "add", mode)] : skip();
      }
      const roll = effect.on === "save" ? "save" : "check";
      if ( scope && !isValidKey(keys, "abilities", scope) ) return skip();
      // dnd5e 5.3.3 has no global roll mode: an unscoped advantage is written on every ability
      // (`abilities.<a>.<check|save>.roll.mode`, an `AdvantageModeField` that counts its sources)
      const abilities = scope ? [scope] : abilitiesOf(keys);
      return abilities.map(ability => change(`system.abilities.${ability}.${roll}.roll.mode`, "add", mode));
    }
    case "abilityScore":
      return isValidKey(keys, "abilities", scope) ? [change(`system.abilities.${scope}.value`, "upgrade", value)] : skip();
    case "damageReduction": {
      // "reduces all incoming bludgeoning, piercing, and slashing damage by 3": dnd5e 6 applies
      // `traits.dm.amount.<type>` (a deterministic formula, added to the damage of that type; `ALL` to every damage
      // type) in `Actor#calculateDamage` (documents/actor/actor.mjs), and skips it for physical damage whose
      // properties meet `traits.dm.bypasses` ("from nonmagical attacks" = the `mgc` bypass).
      const amount = Math.abs(Number(value));
      if ( !Number.isFinite(amount) || !amount ) return skip();
      if ( scope !== "all" && !(lookup("damage", scope) === scope && isValidKey(keys, "damageTypes", scope)) ) return skip();
      const changes = [change(`system.traits.dm.amount.${scope === "all" ? "ALL" : scope}`, "add", `-${amount}`)];
      for ( const bypass of effect.bypasses ?? [] ) {
        if ( BYPASSES.has(bypass) ) changes.push(change("system.traits.dm.bypasses", "add", bypass));
      }
      return changes;
    }
    case "sense":
      // "darkvision out to 120 feet": dnd5e 6 stores senses in `senses.ranges.<key>` (data/shared/senses-field.mjs)
      return lookup("senses", scope) === scope && isValidKey(keys, "senses", scope)
        ? [change(`system.attributes.senses.ranges.${scope}`, "upgrade", String(value))] : skip();
    case "speed":
      // A movement type ("a flying speed of 60 feet") sets that speed; without one, the speed bonus grows.
      // dnd5e 5.3.3 stores speeds in `movement.<type>` (data/shared/movement-field.mjs, deterministic FormulaFields
      // `walk burrow climb fly swim`); `jump` has no field and is skipped.
      if ( scope ) {
        return SPEED_FIELDS.includes(scope) && isValidKey(keys, "movementTypes", scope)
          ? [change(`system.attributes.movement.${scope}`, "upgrade", value)] : skip();
      }
      return [change("system.attributes.movement.bonus", "add", `+${value}`)];
    case "speedMultiplier": {
      // "your speed is halved": dnd5e 5.3.3 has no `movement.multiplier`; each speed field is scaled by a `multiply`
      // change (`FormulaField#_applyChangeMultiply`: `value * delta`, an empty speed stays empty)
      const factor = Number(value);
      if ( !Number.isFinite(factor) || factor <= 0 ) return skip();
      const fields = speedFieldsOf(keys);
      return fields.length ? fields.map(type => change(`system.attributes.movement.${type}`, "multiply", factor)) : skip();
    }
    default:
      return skip();
  }
}

/**
 * Key that groups plan effects into one ActiveEffect: all passive effects together, and on-use effects of the same
 * activity and duration together.
 * @param {object} effect  ItemEffect.
 * @returns {string}
 */
export function effectGroupKey(effect) {
  return effect.when === "onUse" ? `use:${effect.activity ?? ""}:${JSON.stringify(effect.duration ?? null)}` : "passive";
}

/**
 * Translate the effects of an ItemPlan into `ActiveEffect` sources.
 * - Passive effects (worn / wielded / carried): one effect with `transfer: true`; dnd5e suspends it when the item
 *   is not equipped, or not attuned when attunement is required.
 * - `when: "onUse"` effects: one effect per activity, `transfer: false`, with a v13 `duration` (`toEffectDuration`)
 *   when the text gives one,
 *   and `flags["dnd5e-text-parser"].activity` = index of the activity of the plan. `toActivities(plan, { effects })`
 *   puts their `_id` in `activity.effects`.
 * The returned array has a non-enumerable `notes` property (descriptors of the effects that could not be written).
 * @param {object} plan                       ItemPlan.
 * @param {object} context
 * @param {function(): string} context.idGen  Generator of new effect ids.
 * @param {object} [context.keys]             Valid keys (see `keysFromConfig`).
 * @param {string} [context.name]             Name of the effects (default: `plan.name`).
 * @param {string} [context.img]              Image of the effects.
 * @returns {object[]}
 */
export function toEffects(plan, { keys, idGen, name, img } = {}) {
  const result = [];
  const notes = [];
  const label = name || plan?.name || "Effect";
  const groups = new Map();
  for ( const effect of plan?.effects ?? [] ) {
    const changes = changesOf(effect, keys, notes);
    if ( !changes.length ) continue;
    const onUse = effect.when === "onUse";
    const groupKey = effectGroupKey(effect);
    if ( !groups.has(groupKey) ) groups.set(groupKey, { onUse, effect, changes: [] });
    groups.get(groupKey).changes.push(...changes);
  }
  for ( const { onUse, effect, changes: all } of groups.values() ) {
    // The same trait entry written twice (the `mgc` bypass of three damage reductions) is kept once: sets
    const seen = new Set();
    const changes = all.filter(entry => {
      if ( !entry.key.startsWith("system.traits.") ) return true;
      const id = `${entry.key}|${entry.mode}|${entry.value}`;
      return seen.has(id) ? false : seen.add(id);
    });
    const source = { _id: idGen(), name: label, transfer: !onUse, disabled: false, changes };
    if ( img ) source.img = img;
    if ( onUse ) {
      const duration = toEffectDuration(effect.duration);
      if ( duration ) source.duration = duration;
      if ( Number.isInteger(effect.activity) ) source.flags = { [FLAG_SCOPE]: { activity: effect.activity } };
    }
    result.push(source);
  }
  Object.defineProperty(result, "notes", { value: notes, enumerable: false });
  return result;
}
