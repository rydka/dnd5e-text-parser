// L9: validation of the proposals of a fallback resolver (every field), resolveMany, statuses; text helpers.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as P from "../../scripts/index.mjs";

const ITEM_UNKNOWN = "<p><em>Wondrous item, rare</em></p><p>The bearer gently hums a tune that settles the nerves of all nearby.</p>";
const reasons = (r) => r.rejected.map(x => `${x.data.field}:${x.data.reason}`);

describe("validateFallbackFacts: field by field", () => {
  it("accepts well-formed facts of every kind and marks them origin fallback", () => {
    const r = P.validateFallbackFacts({
      attack: { type: "melee", classification: "weapon", bonus: 7, raw: "x" },
      range: { reach: 5, value: null, long: null },
      target: { count: 1, type: "creature" },
      damage: [{ number: 2, denomination: 6, bonus: "3", type: "fire" }],
      save: { ability: "dex", dc: 15, onSave: "half", damage: [{ number: 3, denomination: 8, bonus: "", type: "cold" }] },
      template: { type: "cone", size: 30 },
      uses: { max: 3, period: "day" },
      recharge: { min: 5 },
      activation: { type: "bonus" },
      consume: { amount: 2 },
      cast: { name: "Fireball", level: 3, dc: 15 },
      effects: [{ kind: "resistance", scope: "fire" }, { kind: "ac", value: 1 }],
      details: { rarity: "rare", attunement: "required", attunementCondition: "a wizard", weight: { value: 3 }, price: { value: 50, denomination: "gp" } },
      heal: { number: 2, denomination: 4, bonus: "2" },
      extraDamage: { number: 1, denomination: 6, bonus: "", type: "fire" }
    }, { sentence: "s" });
    expect(reasons(r)).toEqual([]);
    for ( const field of ["attack", "uses", "recharge", "activation", "consume", "cast"] ) expect(r.facts[field].origin).toBe("fallback");
    expect(r.facts.effects.every(e => e.origin === "fallback")).toBe(true);
  });

  it("rejects out of range, wrong type and unknown key, with the reason", () => {
    const r = P.validateFallbackFacts({
      attack: { type: "melee", classification: "weapon", bonus: 99 },
      uses: { max: 0, period: "day" },
      recharge: { min: 9 },
      activation: { type: "teleport" },
      consume: { amount: 0 },
      cast: { name: "", level: 1 },
      effects: [{ kind: "teleportation" }],
      details: { rarity: "mythic" },
      save: { ability: "xyz", dc: 15, onSave: "half", damage: [] },
      damage: [{ number: 500, denomination: 6, bonus: "", type: "fire" }],
      unknownField: 1
    }, { sentence: "s" });
    const got = reasons(r);
    for ( const field of ["attack", "uses", "recharge", "activation", "consume", "cast", "effects", "details", "damage", "unknownField"] ) {
      expect(got.some(x => x.startsWith(`${field}:`)), field).toBe(true);
    }
    expect(r.rejected.every(x => x.key === "dnd5e-text-parser.Note.FallbackRejected")).toBe(true);
    expect(r.facts.attack).toBeUndefined();
  });

  it("checks keys against the valid sets when given", () => {
    const keys = P.keysFromConfig({ damageTypes: { fire: {} }, abilities: { dex: {} }, areaTargetTypes: { cone: {} } });
    const r = P.validateFallbackFacts({ damage: [{ number: 1, denomination: 6, bonus: "", type: "cold" }] }, { keys });
    expect(reasons(r)).toEqual(["damage:key"]);
    expect(reasons(P.validateFallbackFacts("nope", { sentence: "s" }))).toEqual([":type"]);
  });

  it("a healing damage part becomes a heal fact", () => {
    const r = P.validateFallbackFacts({ damage: [{ number: 2, denomination: 4, bonus: "2", type: "healing" }] });
    expect(r.facts.heal).toBeTruthy();
    expect(r.facts.damage ?? []).toHaveLength(0);
  });
});

describe("parseItemAsync: statuses and resolveMany", () => {
  const off = [];
  afterEach(() => { while ( off.length ) off.pop()(); });

  it("unused without resolver; ok with a resolver that proposes valid effects and details", async () => {
    const unused = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment" });
    expect(unused.fallback.status).toBe("unused");
    const resolver = vi.fn(async () => ({ facts: { effects: [{ kind: "ac", value: 1, raw: "hums" }] }, confidence: 0.7 }));
    const plan = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment", fallback: resolver });
    expect(resolver).toHaveBeenCalled();
    expect(plan.fallback.status).toBe("ok");
    expect(plan.effects.some(e => e.origin === "fallback")).toBe(true);
  });

  it("resolveMany: a single call for all sentences; its status is reported", async () => {
    const html = "<p><em>Wondrous item, rare</em></p><p>The bearer hums a tune. The bearer then glows faintly under the moon.</p>";
    const resolveMany = vi.fn(async (requests) => requests.map(() => null));
    const fallback = Object.assign(vi.fn(async () => null), { resolveMany });
    const plan = await P.parseItemAsync("Hummer", html, { itemType: "equipment", fallback });
    expect(resolveMany).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(["ok", "unused"]).toContain(plan.fallback.status);
  });

  it("a resolver that throws gives status error and never raises", async () => {
    const plan = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment", fallback: async () => { throw new Error("down"); } });
    expect(plan.fallback.status).toBe("error");
  });

  it("a resolver that never answers gives status timeout", async () => {
    const plan = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment", timeoutMs: 30, fallback: () => new Promise(() => {}) });
    expect(plan.fallback.status).toBe("timeout");
  });

  it("an aborted signal gives status aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const plan = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment", signal: controller.signal, fallback: async () => null });
    expect(plan.fallback.status).toBe("aborted");
  });

  it("invalid proposals are listed in plan.fallback.rejected and plan.notes", async () => {
    const plan = await P.parseItemAsync("Hummer", ITEM_UNKNOWN, { itemType: "equipment", fallback: async () => ({ facts: { attack: { type: "melee", classification: "weapon", bonus: 99 } } }) });
    expect(plan.fallback.rejected.length).toBeGreaterThan(0);
    expect(plan.notes.some(n => n.key === "dnd5e-text-parser.Note.FallbackRejected")).toBe(true);
  });
});

describe("text helpers", () => {
  it("htmlToText decodes entities and strips enrichers", () => {
    expect(P.htmlToText("<p>Fire &amp; ice&nbsp;&#65;&#x42;&bogus;</p>")).toContain("Fire & ice");
    expect(P.htmlToText("<p>@UUID[Compendium.x.y]{Fireball} deals [[/damage 8d6 fire]] to all, [[/save dex dc=15]] </p>")).toMatch(/Fireball.*8d6 fire damage.*DC 15 Dexterity saving throw/s);
    expect(P.htmlToText("<p>@Embed[Compendium.a.b inline]</p><p>&Reference[Poisoned apply=false] [[/r 2d6]]{two dice} [[/item Bite]]</p>")).toMatch(/Poisoned two dice Bite/);
    expect(P.htmlToText("plain text<br>second line")).toBe("plain text\nsecond line");
  });

  it("splitSentences / splitLines / unit conversions", () => {
    expect(P.splitSentences("One. Two (3.5 ft.) is fine. Three!")).toHaveLength(3);
    expect(P.splitLines("a\n\nb\n").map(l => l.text)).toEqual(["a", "b"]);
    expect(P.toFeet(1.5, "m")).toBe(5);
    expect(P.toFeet(30, "ft")).toBe(30);
    expect(P.toPounds(1, "kg")).toBeCloseTo(2.2, 0);
    expect(P.nameKey("Fire Breath (Recharge 5-6)")).toBe(P.nameKey("fire breath"));
  });
});
