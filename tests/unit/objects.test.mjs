// L2/L6/L7: item details and effects (parseItem, toItemPatch, toEffects), EN and FR.
// parseItem and toEffects are delivered by P4: until they exist these tests fail on the first expectation.
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";
import { loadObjects } from "../support/load.mjs";
import { compare, expectedItemTokens, producedItemTokens } from "../support/canon.mjs";

const cases = loadObjects();

describe("object API is exposed", () => {
  it("parseItem and toEffects are exported", () => {
    expect(typeof P.parseItem).toBe("function");
    expect(typeof P.toEffects).toBe("function");
  });
});

describe.each(["en", "fr"])("L2/L6: item details and effects (%s)", (lang) => {
  it.each(cases.filter(c => c.lang === lang).map(c => [c.id, c]))("%s", (_id, c) => {
    const plan = P.parseItem(c.name, c.html, { itemType: c.itemType });
    const result = compare(expectedItemTokens(c), producedItemTokens(plan, c));
    expect({ missing: result.missing, wrong: result.wrong }).toEqual({ missing: [], wrong: [] });
  });
});

describe("L6: translation of details", () => {
  it("armor bonus goes to armor.magicalBonus, never to an effect", () => {
    const c = cases.find(x => x.id === "o-en-shield-plus2");
    const plan = P.parseItem(c.name, c.html, { itemType: c.itemType });
    expect(plan.effects).toEqual([]);
    expect(P.toItemPatch(plan, { item: { type: c.itemType } }).armor?.magicalBonus).toBe(2);
  });

  it("weapon bonus goes to magicalBonus, never to an effect", () => {
    const c = cases.find(x => x.id === "o-en-longsword-plus1");
    const plan = P.parseItem(c.name, c.html, { itemType: c.itemType });
    expect(plan.effects).toEqual([]);
    expect(P.toItemPatch(plan, { item: { type: c.itemType } }).magicalBonus).toBe(1);
  });

  it("rarity is written as a Set-compatible 'rarities' value (dnd5e 6), not 'rarity'", () => {
    const c = cases.find(x => x.id === "o-en-ring-protection");
    const patch = P.toItemPatch(P.parseItem(c.name, c.html, { itemType: c.itemType }), { item: { type: c.itemType } });
    expect(patch).not.toHaveProperty("rarity");
    expect([...patch.rarities]).toEqual(["rare"]);
  });
});

describe("L7: effects in the v14 format", () => {
  const withEffects = cases.filter(c => c.effects?.length);
  const idGen = (() => { let n = 0; return () => `eff${String(++n).padStart(13, "0")}`; })();

  it.each(withEffects.map(c => [c.id, c]))("%s", (_id, c) => {
    const plan = P.parseItem(c.name, c.html, { itemType: c.itemType });
    const effects = P.toEffects(plan, { idGen });
    expect(effects.length).toBeGreaterThan(0);
    for ( const e of effects ) {
      expect(e.transfer).toBe(true);
      expect(e).not.toHaveProperty("changes");
      expect(e.system.changes.length).toBeGreaterThan(0);
      for ( const ch of e.system.changes ) {
        expect(ch).toHaveProperty("type");
        expect(ch).not.toHaveProperty("mode");
        expect(typeof ch.key).toBe("string");
        expect(ch.key).not.toMatch(/^system\.bonuses\.(mwak|rwak|msak|rsak|abilities)/);
      }
    }
  });

  it("AC bonus targets system.attributes.ac.bonus with an 'add' change", () => {
    const c = cases.find(x => x.id === "o-en-ring-protection");
    const effects = P.toEffects(P.parseItem(c.name, c.html, { itemType: c.itemType }), { idGen });
    const ac = effects.flatMap(e => e.system.changes).find(ch => ch.key === "system.attributes.ac.bonus");
    expect(ac).toMatchObject({ type: "add", value: "+1" });
  });
});
