/**
 * Header of a stat block (`parseStatLines`) to a partial dnd5e 6 NPC `system`. Pure: no Foundry global; the valid
 * keys (`keysFromConfig(CONFIG.DND5E)`) and the world's units are passed as parameters.
 */
import { isValidKey } from "./keys.mjs";
import { traitPatch } from "./actor.mjs";
import { STAT_LEXICON } from "../parse/lexicon/stat-block.mjs";

const TRAIT_KINDS = ["dr", "di", "dv", "ci"];
const NOTE = "dnd5e-text-parser.Note";

/** Feet to metres (1.5 m = 5 ft), to the centimetre: 30 -> 9, 5 -> 1.5, 33 -> 9.9. */
const toMetres = feet => Math.round(Number(feet) * 30) / 100;

/**
 * Length in the world's unit.
 * @param {number} feet
 * @param {boolean} metric
 * @returns {number}
 */
const length = (feet, metric) => (metric ? toMetres(feet) : Number(feet));

/**
 * Translate the header of a stat block into a partial dnd5e 6 NPC `system`.
 * Only keys present in `keys` are written (a dropped key gives `Note.NpcKeyInvalid`); nothing is invented: a null
 * field writes nothing. Distances are converted to the world's unit (1.5 m = 5 ft, no rounding to the integer,
 * except sense ranges, which dnd5e stores as integers: `Note.RangeRounded`).
 * @param {object} stats  Result of `parseStatLines`; `stats.size` is the result of `parseSizeLine` (set by
 *   `parseStatLines` when the text holds the size line, or by the caller).
 * @param {{ keys?: object, metric?: boolean|{ length?: boolean, weight?: boolean } }} [options]  `metric`: units of
 *   the world (`true` = metric lengths; `{ length }` as read from the dnd5e setting `metricLengthUnits`).
 * @returns {{ system: object, notes: object[] }}
 */
export function toNpcPatch(stats, { keys, metric } = {}) {
  const system = {};
  const notes = [];
  const metricLength = typeof metric === "object" && metric !== null ? !!metric.length : !!metric;
  const units = metricLength ? "m" : "ft";
  const skip = (field, value) => notes.push({ key: `${NOTE}.NpcKeyInvalid`, data: { field, value } });
  const valid = (set, value, field) => {
    if ( isValidKey(keys, set, value) ) return true;
    skip(field, value);
    return false;
  };
  if ( !stats ) return { system, notes };

  const abilities = {};
  for ( const [key, value] of Object.entries(stats.abilities ?? {}) ) {
    if ( !Number.isFinite(value) || !valid("abilities", key, "abilities") ) continue;
    abilities[key] = { value };
  }
  for ( const key of Object.keys(stats.saves ?? {}) ) {
    if ( !valid("abilities", key, "saves") ) continue;
    abilities[key] = { ...(abilities[key] ?? {}), proficient: 1 };
  }
  if ( Object.keys(abilities).length ) system.abilities = abilities;

  const attributes = {};
  if ( stats.ac && Number.isFinite(stats.ac.value) ) {
    // dnd5e 6: `natural` computes @attributes.ac.flat (config.mjs:1645). A printed AC without a natural armor
    // (none, or an armor the actor does not own as an item) takes the same form (reports/rules/voice-scribe-initial.md
    // § 2): the label reads "Natural Armor" but the value is exact. `calc` / `formula` are no longer persisted.
    attributes.ac = { calcs: ["natural"], flat: stats.ac.value };
  }
  if ( stats.hp && Number.isFinite(stats.hp.value) ) {
    attributes.hp = { value: stats.hp.value, max: stats.hp.value, formula: stats.hp.formula ?? "" };
  }
  if ( stats.speed ) {
    const speeds = {};
    for ( const [type, feet] of Object.entries(stats.speed.speeds ?? {}) ) {
      if ( !Number.isFinite(feet) || !valid("movementTypes", type, "speed") ) continue;
      speeds[type] = String(length(feet, metricLength));
    }
    if ( Object.keys(speeds).length ) attributes.movement = { speeds, units, hover: !!stats.speed.hover };
  }
  if ( stats.senses ) {
    const ranges = {};
    for ( const [sense, feet] of Object.entries(stats.senses.ranges ?? {}) ) {
      if ( !Number.isFinite(feet) || !valid("senses", sense, "senses") ) continue;
      const value = length(feet, metricLength);
      // SensesField stores integers (data/shared/senses-field.mjs:16)
      const stored = Number.isInteger(value) ? value : Math.round(value);
      if ( stored !== value ) notes.push({ key: `${NOTE}.RangeRounded`, data: { field: `senses.${sense}`, from: value, to: stored } });
      ranges[sense] = stored;
    }
    const special = stats.senses.special ?? "";
    if ( Object.keys(ranges).length || special ) attributes.senses = { ranges, units, special };
  }
  const initiative = stats.initiative?.bonus;
  if ( Number.isFinite(initiative) ) {
    // The printed initiative already holds the Dexterity modifier, which dnd5e adds itself: only the remainder
    // (proficiency, bonuses) goes to `init.bonus`. Without the Dexterity score the remainder is unknown.
    const dex = stats.abilities?.dex;
    if ( Number.isFinite(dex) ) {
      const extra = initiative - Math.floor((dex - 10) / 2);
      if ( extra ) attributes.init = { bonus: String(extra) };
    } else notes.push({ key: `${NOTE}.InitiativeSkipped`, data: { bonus: initiative } });
  }
  if ( Object.keys(attributes).length ) system.attributes = attributes;

  const skills = {};
  for ( const [key, level] of Object.entries(stats.skills ?? {}) ) {
    if ( !Number.isFinite(level) || !valid("skills", key, "skills") ) continue;
    const ability = STAT_LEXICON.skillAbilities[key];
    skills[key] = ability && isValidKey(keys, "abilities", ability) ? { value: level, ability } : { value: level };
  }
  if ( Object.keys(skills).length ) system.skills = skills;

  const details = {};
  if ( Number.isFinite(stats.cr) ) details.cr = stats.cr;
  const traits = {};
  const size = stats.size;
  if ( size ) {
    if ( size.size && valid("actorSizes", size.size, "size") ) traits.size = size.size;
    if ( size.type && valid("creatureTypes", size.type, "type") ) {
      const swarm = size.swarm && isValidKey(keys, "actorSizes", size.swarm) ? size.swarm : "";
      if ( size.swarm && !swarm ) skip("swarm", size.swarm);
      details.type = { value: size.type, subtype: size.subtype ?? "", swarm, custom: "" };
    }
    if ( size.alignment ) details.alignment = size.alignment;
  }
  if ( Object.keys(details).length ) system.details = details;

  for ( const kind of TRAIT_KINDS ) {
    const planned = stats.traits?.[kind];
    if ( !planned ) continue;
    const result = traitPatch(kind, planned, undefined, keys);
    notes.push(...result.notes);
    if ( result.patch ) traits[kind] = result.patch;
  }
  if ( stats.languages ) {
    const value = [];
    const custom = String(stats.languages.custom ?? "").split(";").map(s => s.trim()).filter(Boolean);
    for ( const key of stats.languages.value ?? [] ) {
      if ( isValidKey(keys, "languages", key) ) value.push(key);
      else { skip("languages", key); custom.push(key); }
    }
    const languages = { value, custom: custom.join("; ") };
    const telepathy = stats.languages.communication?.telepathy;
    if ( telepathy && Number.isFinite(telepathy.value) ) {
      languages.communication = { telepathy: { value: length(telepathy.value, metricLength), units } };
    }
    if ( value.length || languages.custom || languages.communication ) traits.languages = languages;
  }
  if ( Object.keys(traits).length ) system.traits = traits;

  return { system, notes };
}
