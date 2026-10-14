import { parseFeature } from "./plan.mjs";
import { parseItem } from "./item-plan.mjs";
import { getFallback } from "../registry.mjs";
import { LEXICON } from "./lexicon/index.mjs";

/**
 * Asynchronous parsing with the fallback resolver (extension point, see `registerFallback`).
 * The resolver is only asked about sentences the rules did not recognize; its proposals are validated, never
 * replace a fact found by the rules, and are marked `origin: "fallback"`. No exception from the resolver reaches
 * the caller. Pure apart from the calls to the resolver.
 */

const DEFAULT_TIMEOUT_MS = 5000;
const NOTE_REJECTED = "dnd5e-text-parser.Note.FallbackRejected";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const set = value => (value && typeof value.has === "function" ? value : null);
const ABILITIES = new Set(Object.values(LEXICON.abilities));
const DAMAGE_TYPES = new Set(Object.values(LEXICON.damage));
const ZONES = new Set(Object.values(LEXICON.zones));
const EFFECT_KINDS = new Set(["ac", "attack", "damage", "save", "check", "resistance", "immunity", "vulnerability",
  "advantage", "disadvantage", "abilityScore", "speed"]);

/** A set of valid keys: from `keys[name]` when given, else the fallback list. */
const allowed = (keys, name, fallback) => set(keys?.[name]) ?? fallback;

class Reject extends Error {}
const reject = reason => { throw new Reject(reason); };

function checkDamagePart(value, keys, origin = "damage") {
  if ( !isObject(value) ) reject("type");
  const { number = null, denomination = null } = value;
  if ( number !== null && !isInt(number, 1, 100) ) reject("bound");
  if ( denomination !== null && !isInt(denomination, 2, 100) ) reject("bound");
  if ( (number === null) !== (denomination === null) ) reject("type");
  let bonus = value.bonus ?? "";
  if ( typeof bonus === "number" ) bonus = String(bonus);
  if ( typeof bonus !== "string" || !/^(?:[+-]?\s*\d+(?:\s*[+-]\s*\d+)*)?$/.test(bonus.trim()) ) reject("type");
  if ( number === null && !bonus.trim() ) reject("type");
  let type = value.type ?? null;
  if ( type !== null ) {
    if ( typeof type !== "string" ) reject("type");
    const valid = origin === "heal" ? new Set(["healing", "temphp"]) : allowed(keys, "damageTypes", DAMAGE_TYPES);
    if ( !valid.has(type) ) reject("key");
  }
  return { number, denomination, bonus: bonus.trim(), type, raw: String(value.raw ?? ""), origin: "fallback" };
}

const VALIDATORS = {
  attack(value) {
    if ( !isObject(value) ) reject("type");
    const { type = null, classification = null, bonus } = value;
    if ( ![null, "melee", "ranged"].includes(type) || ![null, "weapon", "spell"].includes(classification) ) reject("key");
    if ( !isInt(bonus, -5, 30) ) reject(Number.isFinite(bonus) ? "bound" : "type");
    return { type, classification, bonus, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  range(value) {
    if ( !isObject(value) ) reject("type");
    const result = { raw: String(value.raw ?? ""), origin: "fallback" };
    for ( const key of ["reach", "value", "long"] ) {
      const entry = value[key] ?? null;
      if ( entry !== null && (!Number.isFinite(entry) || entry < 0 || entry > 100000) ) reject("bound");
      result[key] = entry;
    }
    if ( result.reach === null && result.value === null ) reject("type");
    return result;
  },
  target(value) {
    if ( !isObject(value) ) reject("type");
    if ( !isInt(value.count, 1, 100) ) reject("bound");
    if ( ![undefined, null, "", "creature"].includes(value.type) ) reject("key");
    return { count: value.count, type: value.type ?? "", raw: String(value.raw ?? ""), origin: "fallback" };
  },
  damage(value, keys) {
    if ( !Array.isArray(value) ) reject("type");
    return value.map(part => checkDamagePart(part, keys));
  },
  heal(value, keys) {
    return checkDamagePart(value, keys, "heal");
  },
  extraDamage(value, keys) {
    return checkDamagePart(value, keys);
  },
  save(value, keys) {
    if ( !isObject(value) ) reject("type");
    if ( !allowed(keys, "abilities", ABILITIES).has(value.ability) ) reject("key");
    if ( !isInt(value.dc, 5, 40) ) reject(Number.isFinite(value.dc) ? "bound" : "type");
    if ( !["half", "none"].includes(value.onSave ?? "none") ) reject("key");
    const damage = (value.damage ?? []).map(part => checkDamagePart(part, keys));
    return { ability: value.ability, dc: value.dc, onSave: value.onSave ?? "none", damage, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  template(value, keys) {
    if ( !isObject(value) ) reject("type");
    if ( !allowed(keys, "areaTargetTypes", ZONES).has(value.type) ) reject("key");
    if ( !isInt(value.size, 1, 10000) ) reject("bound");
    return {
      type: value.type, size: value.size, width: value.width ?? null, height: value.height ?? null,
      raw: String(value.raw ?? ""), origin: "fallback"
    };
  },
  uses(value) {
    if ( !isObject(value) ) reject("type");
    if ( !isInt(value.max, 1, 100) ) reject("bound");
    if ( !["day", "dawn", "dusk", "sr", "lr"].includes(value.period) ) reject("key");
    return { max: value.max, period: value.period, recoverFormula: value.recoverFormula ?? null, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  recharge(value) {
    if ( !isObject(value) || !isInt(value.min, 2, 6) ) reject("bound");
    return { min: value.min, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  activation(value, keys) {
    if ( !isObject(value) ) reject("type");
    if ( !allowed(keys, "activityActivationTypes", new Set(["action", "bonus", "reaction", "legendary", "special"])).has(value.type) ) reject("key");
    if ( value.cost !== undefined && value.cost !== null && !isInt(value.cost, 1, 10) ) reject("bound");
    return { type: value.type, cost: value.cost ?? null, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  consume(value) {
    if ( !isObject(value) || !isInt(value.amount, 1, 100) ) reject("bound");
    return { target: "itemUses", amount: value.amount, raw: String(value.raw ?? ""), origin: "fallback" };
  },
  cast(value) {
    if ( !isObject(value) || typeof value.name !== "string" || !value.name.trim() ) reject("type");
    const dc = value.dc ?? null;
    const attack = value.attack ?? null;
    if ( dc !== null && !isInt(dc, 5, 40) ) reject("bound");
    if ( attack !== null && !isInt(attack, -5, 30) ) reject("bound");
    return {
      name: value.name.trim(), level: isInt(value.level, 0, 9) ? value.level : null, dc, attack,
      charges: isInt(value.charges, 1, 100) ? value.charges : null, raw: String(value.raw ?? ""), origin: "fallback"
    };
  },
  effects(value, keys) {
    if ( !Array.isArray(value) ) reject("type");
    return value.map(effect => {
      if ( !isObject(effect) || !EFFECT_KINDS.has(effect.kind) ) reject("key");
      const entry = effect.value ?? null;
      if ( entry !== null && typeof entry !== "number" && typeof entry !== "string" ) reject("type");
      if ( typeof entry === "number" && Math.abs(entry) > 1000 ) reject("bound");
      if ( ["resistance", "immunity", "vulnerability"].includes(effect.kind)
        && !allowed(keys, "damageTypes", DAMAGE_TYPES).has(effect.scope)
        && !allowed(keys, "conditionTypes", new Set(Object.values(LEXICON.conditions))).has(effect.scope) ) reject("key");
      return {
        kind: effect.kind, value: entry, scope: effect.scope ?? null, ...(effect.on ? { on: effect.on } : {}),
        when: "passive", duration: null, activity: null, raw: String(effect.raw ?? ""), origin: "fallback"
      };
    });
  },
  details(value, keys) {
    if ( !isObject(value) ) reject("type");
    const result = {};
    if ( value.rarity !== undefined ) {
      if ( !allowed(keys, "itemRarity", new Set(Object.values(LEXICON.rarity))).has(value.rarity) ) reject("key");
      result.rarity = value.rarity;
    }
    if ( value.attunement !== undefined ) {
      if ( !["required", "optional"].includes(value.attunement) ) reject("key");
      result.attunement = value.attunement;
    }
    if ( typeof value.attunementCondition === "string" ) result.attunementCondition = value.attunementCondition;
    if ( value.weight !== undefined ) {
      if ( !isObject(value.weight) || !(value.weight.value >= 0) || value.weight.value > 100000 ) reject("bound");
      result.weight = { value: value.weight.value, units: "lb", raw: String(value.weight.raw ?? ""), origin: "fallback" };
    }
    if ( value.price !== undefined ) {
      if ( !isObject(value.price) || !(value.price.value >= 0) ) reject("bound");
      if ( !allowed(keys, "currencies", new Set(Object.values(LEXICON.currency))).has(value.price.denomination) ) reject("key");
      result.price = { value: value.price.value, denomination: value.price.denomination, raw: String(value.price.raw ?? ""), origin: "fallback" };
    }
    if ( !Object.keys(result).length ) reject("type");
    return result;
  }
};

/**
 * Validate the facts proposed by a fallback resolver: same types as the plan, keys checked against `keys`, bounds
 * (attack bonus -5..30, save DC 5..40, dice 1-100 d 2-100). What is invalid is rejected (never corrected).
 * @param {object} facts                       Partial ItemPlan proposed by the resolver.
 * @param {{ keys?: object, sentence?: string }} [options]
 * @returns {{ facts: object, rejected: { key: string, data: object }[] }}
 *   `facts` holds the valid fields, every fact carrying `origin: "fallback"`; `rejected` lists
 *   `dnd5e-text-parser.Note.FallbackRejected` descriptors `{ field, reason: "type"|"bound"|"key", raw }`.
 */
export function validateFallbackFacts(facts, { keys, sentence = "" } = {}) {
  const valid = {};
  const rejected = [];
  if ( !isObject(facts) ) {
    rejected.push({ key: NOTE_REJECTED, data: { field: "", reason: "type", raw: sentence } });
    return { facts: valid, rejected };
  }
  for ( const [field, value] of Object.entries(facts) ) {
    if ( value === undefined || value === null ) continue;
    const validator = VALIDATORS[field];
    try {
      if ( !validator ) reject("key");
      valid[field] = validator(value, keys);
    } catch(error) {
      rejected.push({
        key: NOTE_REJECTED, data: { field, reason: error instanceof Reject ? error.message : "type", raw: sentence }
      });
    }
  }
  return { facts: valid, rejected };
}

/** Fields of a plan the resolver may fill, in the order they are asked for. */
const WANTED = ["attack", "damage", "save", "template", "uses", "activation"];
const WANTED_ITEM = [...WANTED, "effects", "details"];

function wantedFor(plan, isItem) {
  return (isItem ? WANTED_ITEM : WANTED).filter(field => {
    if ( field === "damage" ) return !plan.damage?.length;
    if ( field === "effects" ) return !plan.effects?.length;
    if ( field === "details" ) return !Object.keys(plan.details ?? {}).length;
    return !plan[field];
  });
}

const guessLang = (sentence, languages) => (languages?.length === 1 ? languages[0]
  : (/[àâçéèêëîïôûùüœ]|\b(?:le|la|les|un|une|des|du|dégâts|jet)\b/iu.test(sentence) ? "fr" : "en"));

/**
 * Ask the resolver about every request, with one global deadline.
 * @returns {Promise<{ results: Array<object|null>, status: string, calls: number }>}
 */
async function callResolver(resolver, requests, { signal, timeoutMs }) {
  const controller = new AbortController();
  const state = { reason: null };
  const stop = reason => { state.reason ??= reason; controller.abort(); };
  const onAbort = () => stop("aborted");
  if ( signal?.aborted ) return { results: [], status: "aborted", calls: 0 };
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const stopped = new Promise(resolve => controller.signal.addEventListener("abort", resolve, { once: true }));
  const options = { signal: controller.signal };
  let status = null;
  let calls = requests.length;

  const work = (async () => {
    if ( typeof resolver.resolveMany === "function" ) {
      calls = 1;
      try {
        const out = await resolver.resolveMany(requests, options);
        status = out?.status ?? resolver.lastRun?.status ?? null;
        return Array.isArray(out) ? out : [];
      } catch {
        status = "error";
        return [];
      }
    }
    let failures = 0;
    const out = await Promise.all(requests.map(async request => {
      try {
        return await resolver(request, options);
      } catch {
        failures++;
        return null;
      }
    }));
    status = resolver.lastRun?.status ?? (failures ? "error" : null);
    return out;
  })();

  try {
    const results = await Promise.race([work, stopped.then(() => null)]);
    if ( results === null ) return { results: [], status: state.reason ?? "aborted", calls };
    return { results, status: state.reason ?? status ?? "ok", calls };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    work.catch(() => {});
  }
}

/** Merge the valid facts into the plan: a fact of the rules is never replaced. Returns what was added. */
function mergeFacts(plan, facts, sentence, isItem) {
  const added = [];
  for ( const field of ["attack", "range", "target", "save", "template", "uses", "recharge", "activation"] ) {
    if ( facts[field] && !plan[field] ) { plan[field] = facts[field]; added.push(field); }
  }
  if ( facts.damage?.length && !plan.damage.length ) { plan.damage = facts.damage; added.push("damage"); }
  if ( isItem ) {
    if ( facts.details ) {
      plan.details ??= {};
      for ( const [key, value] of Object.entries(facts.details) ) {
        if ( plan.details[key] === undefined ) { plan.details[key] = value; added.push(`details.${key}`); }
      }
    }
    for ( const effect of facts.effects ?? [] ) {
      const same = plan.effects.some(entry => entry.kind === effect.kind && entry.scope === effect.scope);
      if ( !same ) { plan.effects.push(effect); added.push("effects"); }
    }
    if ( facts.heal || facts.cast || facts.consume || facts.extraDamage ) {
      plan.activities ??= [];
      plan.activities.push({
        kind: facts.cast ? "cast" : facts.heal ? "heal" : "utility", name: facts.cast?.name ?? "", raw: sentence,
        index: plan.activities.length, activation: facts.activation ?? null, attack: null, range: null, target: null,
        template: null, damage: [], save: null, heal: facts.heal ?? null, cast: facts.cast ?? null,
        consume: facts.consume ?? null, extraDamage: facts.extraDamage ?? null, origin: "fallback"
      });
      added.push("activities");
    }
  }
  return added;
}

async function parseAsync(plan, text, opts, isItem) {
  const fallback = { status: "unused", calls: 0, rejected: [] };
  plan.fallback = fallback;
  try {
    const resolver = opts.fallback ?? getFallback();
    if ( typeof resolver !== "function" || !plan.unrecognized.length ) return plan;
    const requests = plan.unrecognized.map(entry => ({
      sentence: entry.text,
      context: { name: String(text.name ?? ""), itemType: opts.itemType, lang: guessLang(entry.text, opts.languages), plan },
      wanted: wantedFor(plan, isItem)
    }));
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const { results, status, calls } = await callResolver(resolver, requests, { signal: opts.signal, timeoutMs });
    fallback.status = status;
    fallback.calls = calls;
    const resolved = new Set();
    results.forEach((result, index) => {
      if ( !isObject(result) || !isObject(result.facts) ) return;
      const sentence = plan.unrecognized[index]?.text ?? "";
      const { facts, rejected } = validateFallbackFacts(result.facts, { keys: opts.keys, sentence });
      fallback.rejected.push(...rejected);
      if ( mergeFacts(plan, facts, sentence, isItem).length ) resolved.add(index);
    });
    plan.unrecognized = plan.unrecognized.filter((entry, index) => !resolved.has(index));
    plan.notes.push(...fallback.rejected);
  } catch {
    fallback.status = "error";
  }
  return plan;
}

/**
 * `parseFeature` followed by a pass of the fallback resolver on the unrecognized sentences.
 * Never throws because of the resolver. `plan.fallback = { status, calls, rejected }` with `status` one of
 * `unused` (no resolver or nothing to ask), `ok`, `timeout`, `aborted`, `error`, or the status reported by the
 * resolver (`resolver.lastRun.status` / `results.status`, e.g. `unreachable`, `no-model`, `invalid`).
 * With a `resolveMany(requests, { signal })` method on the resolver, one call is made for all sentences;
 * otherwise one call per sentence, in parallel. `timeoutMs` and `signal` apply to the whole pass.
 * @param {string} name
 * @param {string} html
 * @param {{ languages?: string[], keys?: object, fallback?: function, signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<object>} FeaturePlan
 */
export function parseFeatureAsync(name, html, opts = {}) {
  return parseAsync(parseFeature(name, html, opts), { name }, opts, false);
}

/**
 * `parseItem` followed by a pass of the fallback resolver (see `parseFeatureAsync`).
 * @param {string} name
 * @param {string} html
 * @param {{ languages?: string[], keys?: object, itemType?: string, fallback?: function, signal?: AbortSignal,
 *   timeoutMs?: number }} [opts]
 * @returns {Promise<object>} ItemPlan
 */
export function parseItemAsync(name, html, opts = {}) {
  return parseAsync(parseItem(name, html, opts), { name }, opts, true);
}
