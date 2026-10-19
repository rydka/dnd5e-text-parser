// L9: the fallback resolver is called only on unrecognized sentences; its proposals are validated and
// marked origin "fallback"; rule facts are never replaced; the timeout is honoured.
// parseFeatureAsync is delivered by P4: until it exists these tests fail on the first expectation.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as P from "../../scripts/index.mjs";

const RECOGNIZED = "<p><small>Action</small><br/><strong>Bite.</strong> Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage.</p>";
const WITH_UNKNOWN = "<p><strong>Flame Whip.</strong> +5 to hit, reach 10 ft., one target. Hit: 7 (1d8 + 3) fire damage. The creature then flings a curtain of embers two paces wide in front of it.</p>";
const ONLY_UNKNOWN = "<p><strong>Ember Curtain.</strong> The creature flings a curtain of embers two paces wide in front of it.</p>";

const keys = { damageTypes: new Set(["fire", "cold", "piercing"]) };
const resolverReturning = (facts, confidence = 0.9) => vi.fn(async () => ({ facts, confidence }));
const unregisterAll = [];
afterEach(() => { while ( unregisterAll.length ) unregisterAll.pop()(); });

describe("L9: availability", () => {
  it("parseFeatureAsync, parseItemAsync and the registry are exported", () => {
    expect(typeof P.parseFeatureAsync).toBe("function");
    expect(typeof P.parseItemAsync).toBe("function");
    expect(typeof P.registerFallback).toBe("function");
  });

  it("registerFallback / getFallback / unregister", () => {
    const resolver = async () => null;
    const off = P.registerFallback("test-module", resolver);
    expect(P.getFallback()).toBe(resolver);
    off();
    expect(P.getFallback()).not.toBe(resolver);
  });
});

describe("L9: when the resolver is called", () => {
  it("never by the synchronous parser", () => {
    const fallback = resolverReturning({});
    unregisterAll.push(P.registerFallback("sync-check", fallback));
    P.parseFeature("Ember Curtain", ONLY_UNKNOWN);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("never when every sentence is recognized", async () => {
    const fallback = resolverReturning({});
    const plan = await P.parseFeatureAsync("Bite", RECOGNIZED, { fallback, keys });
    expect(fallback).not.toHaveBeenCalled();
    expect(plan.unrecognized).toEqual([]);
  });

  it("once per unrecognized sentence, with that sentence only", async () => {
    const fallback = resolverReturning(null);
    const plan = await P.parseFeatureAsync("Flame Whip", WITH_UNKNOWN, { fallback, keys });
    expect(plan.unrecognized.length).toBeGreaterThan(0);
    expect(fallback).toHaveBeenCalledTimes(plan.unrecognized.length);
    const request = fallback.mock.calls[0][0];
    expect(request.sentence).toMatch(/curtain of embers/);
    expect(request.sentence).not.toMatch(/Hit: 7/);
    expect(request.context.name).toBe("Flame Whip");
    expect(Array.isArray(request.wanted)).toBe(true);
    expect(fallback.mock.calls[0][1]).toHaveProperty("signal");
  });

  it("a registered resolver is used when none is passed in the options", async () => {
    const fallback = resolverReturning(null);
    unregisterAll.push(P.registerFallback("registered", fallback));
    await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { keys });
    expect(fallback).toHaveBeenCalled();
  });

  it("a resolver that returns null or throws changes nothing and raises nothing", async () => {
    const reference = P.parseFeature("Flame Whip", WITH_UNKNOWN);
    for ( const fallback of [async () => null, async () => { throw new Error("boom"); }, () => { throw new Error("sync boom"); }] ) {
      const plan = await P.parseFeatureAsync("Flame Whip", WITH_UNKNOWN, { fallback, keys });
      expect(plan.attack).toEqual(reference.attack);
      expect(plan.damage).toEqual(reference.damage);
    }
  });
});

describe("L9: validation and marking of proposals", () => {
  const damagePart = (over = {}) => ({ number: 2, denomination: 6, bonus: "", type: "fire", raw: "two six-sided dice of fire", ...over });

  it("a valid proposal is added and marked origin 'fallback'", async () => {
    const fallback = resolverReturning({ damage: [damagePart()] });
    const plan = await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys });
    expect(plan.damage).toHaveLength(1);
    expect(plan.damage[0]).toMatchObject({ number: 2, denomination: 6, type: "fire", origin: "fallback" });
  });

  it("describe flags the fallback origin", async () => {
    const fallback = resolverReturning({ damage: [damagePart()] });
    const plan = await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys });
    expect(JSON.stringify(P.describe(plan))).toMatch(/"origin":"fallback"/);
  });

  it.each([
    ["dice count above 100", { damage: [damagePart({ number: 101 })] }, "damage"],
    ["die size 1", { damage: [damagePart({ denomination: 1 })] }, "damage"],
    ["die size above 100", { damage: [damagePart({ denomination: 101 })] }, "damage"],
    ["damage type outside keys", { damage: [damagePart({ type: "plasma" })] }, "damage"],
    ["attack bonus above +30", { attack: { type: "melee", classification: "weapon", bonus: 31 } }, "attack"],
    ["attack bonus below -5", { attack: { type: "melee", classification: "weapon", bonus: -6 } }, "attack"],
    ["save DC below 5", { save: { ability: "wis", dc: 4, onSave: "none", damage: [] } }, "save"],
    ["save DC above 40", { save: { ability: "wis", dc: 41, onSave: "none", damage: [] } }, "save"],
    ["unknown ability", { save: { ability: "luck", dc: 12, onSave: "none", damage: [] } }, "save"],
    ["wrong type for a field", { damage: "2d6 fire" }, "damage"]
  ])("rejects %s, with a note", async (_label, facts, field) => {
    const fallback = resolverReturning(facts);
    const plan = await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys });
    const value = plan[field];
    expect(Array.isArray(value) ? value : (value ? [value] : [])).toEqual([]);
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  it("accepts the bounds (attack -5 and +30, DC 5 and 40, 100d100)", async () => {
    for ( const facts of [
      { attack: { type: "melee", classification: "weapon", bonus: -5 } },
      { attack: { type: "melee", classification: "weapon", bonus: 30 } },
      { save: { ability: "wis", dc: 5, onSave: "none", damage: [] } },
      { save: { ability: "wis", dc: 40, onSave: "none", damage: [] } },
      { damage: [damagePart({ number: 100, denomination: 100 })] }
    ] ) {
      const plan = await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback: resolverReturning(facts), keys });
      const field = Object.keys(facts)[0];
      expect(plan[field], JSON.stringify(facts)).toBeTruthy();
    }
  });

  it("never replaces a fact found by the rules", async () => {
    const reference = P.parseFeature("Flame Whip", WITH_UNKNOWN);
    const fallback = resolverReturning({
      attack: { type: "ranged", classification: "spell", bonus: 9 },
      range: { reach: null, value: 60, long: null },
      damage: [damagePart({ number: 9, denomination: 9, type: "cold" })]
    });
    const plan = await P.parseFeatureAsync("Flame Whip", WITH_UNKNOWN, { fallback, keys });
    expect(plan.attack).toEqual(reference.attack);
    expect(plan.range).toEqual(reference.range);
    expect(plan.damage).toEqual(reference.damage);
    expect(plan.attack.origin ?? "rules").toBe("rules");
  });
});

describe("L9: timeout and cancellation", () => {
  it("returns the rule-based plan once timeoutMs elapsed", async () => {
    const fallback = vi.fn(() => new Promise(() => {}));
    const started = performance.now();
    const plan = await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys, timeoutMs: 60 });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1500);
    expect(plan.unrecognized.length).toBeGreaterThan(0);
  });

  it("passes an AbortSignal that is aborted on timeout", async () => {
    let received;
    const fallback = vi.fn((_req, { signal }) => { received = signal; return new Promise(() => {}); });
    await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys, timeoutMs: 40 });
    expect(received.aborted).toBe(true);
  });

  it("an already aborted signal prevents any call", async () => {
    const fallback = resolverReturning({});
    const controller = new AbortController();
    controller.abort();
    await P.parseFeatureAsync("Ember Curtain", ONLY_UNKNOWN, { fallback, keys, signal: controller.signal });
    expect(fallback).not.toHaveBeenCalled();
  });
});
