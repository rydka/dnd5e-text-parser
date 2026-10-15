// Tests for the review fixes (library at c90da47). Texts written for these tests only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `r${++n}`.padEnd(16, "0");
const item = (name, html, itemType = "equipment") => P.parseItem(name, html, { keys, itemType });
const patch = (name, html, type = "weapon") => P.toItemPatch(item(name, html, type), { item: { type }, keys });

describe("speed effect path", () => {
  it("writes movement.speeds.<type>, not the deprecated movement.<type>", () => {
    const plan = item("Boots of Skies", "<p>Wondrous Item, Rare. While you wear these boots, you have a flying speed of 40 feet.</p>", "equipment");
    const changes = P.toEffects(plan, { idGen, keys }).flatMap(e => e.system.changes);
    const speed = changes.filter(c => /movement/.test(c.key));
    expect(speed.length).toBeGreaterThan(0);
    expect(speed.map(c => c.key)).toContain("system.attributes.movement.speeds.fly");
    expect(speed.every(c => /^system\.attributes\.movement\.(speeds\.|bonus)/.test(c.key))).toBe(true);
  });
});

describe("validateFallbackFacts: hostile proposals", () => {
  const ok = (effects) => P.validateFallbackFacts({ effects }, { sentence: "s", keys });
  const reasons = (r) => r.rejected.map(x => `${x.data.field}:${x.data.reason}`);

  it("refuses prototype-name scopes", () => {
    for ( const scope of ["constructor", "toString", "__proto__"] ) {
      for ( const kind of ["resistance", "save", "speed", "abilityScore"] ) {
        const r = ok([{ kind, scope }]);
        expect(r.facts.effects ?? [], `${kind}/${scope}`).toEqual([]);
        expect(reasons(r).length, `${kind}/${scope}`).toBeGreaterThan(0);
      }
    }
  });

  it("refuses a formula-reference value", () => {
    const r = ok([{ kind: "ac", value: "@abilities.str.mod" }]);
    expect(r.facts.effects ?? []).toEqual([]);
    expect(reasons(r).length).toBeGreaterThan(0);
  });

  it("refuses a root field named constructor, and toEffects does not throw", () => {
    const facts = JSON.parse('{"constructor": {"x": 1}, "effects": [{"kind": "resistance", "scope": "constructor"}]}');
    const r = P.validateFallbackFacts(facts, { sentence: "s", keys });
    expect(reasons(r).some(x => x.startsWith("constructor:"))).toBe(true);
    expect(Object.hasOwn(r.facts, "constructor")).toBe(false);
    const plan = item("Odd", "<p>Wondrous Item, Rare. Hums.</p>");
    plan.effects.push(...(r.facts.effects ?? []));
    expect(() => P.toEffects(plan, { idGen, keys })).not.toThrow();
  });
});

describe("weapon mastery", () => {
  const mastery = (name, text) => patch(name, `<p>${text}</p>`).mastery;
  it("EN Nick and Cleave", () => {
    expect(mastery("Dirk", "Weapon (dagger), Common. Mastery: Nick")).toBe("nick");
    expect(mastery("Greataxe", "Weapon (greataxe), Common. Mastery: Cleave")).toBe("cleave");
  });
  it("FR Coup rapide and Enchaînement", () => {
    expect(mastery("Dague", "Arme (dague), commune. Maîtrise : Coup rapide")).toBe("nick");
    expect(mastery("Grande hache", "Arme (grande hache), commune. Maîtrise d'arme : Enchaînement")).toBe("cleave");
  });
  it("an unknown mastery gives a note and no key", () => {
    const plan = item("Blade", "<p>Weapon (longsword), Common. Mastery: Flourish</p>", "weapon");
    expect(JSON.stringify(plan.notes)).toContain("Note.MasteryUnknown");
    expect(patch("Blade", "<p>Weapon (longsword), Common. Mastery: Flourish</p>").mastery).toBeUndefined();
    const fr = item("Lame", "<p>Arme (épée longue), commune. Maîtrise : Tourbillon</p>", "weapon");
    expect(JSON.stringify(fr.notes)).toContain("Note.MasteryUnknown");
  });
});

describe("htmlToText on pathological input", () => {
  it.each([["<", "<"], ["@UUID[", "@UUID["], ["[[/", "[[/"]])("180 000 characters of unclosed %s run under 100 ms", (label, unit) => {
    const html = `<p>${(unit + "a ").repeat(Math.ceil(180000 / (unit.length + 2)))}</p>`.slice(0, 180000);
    const start = performance.now();
    P.htmlToText(html);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("unrecognized has no punctuation fragments", () => {
  it("every entry holds a letter or digit", () => {
    const plan = P.parseFeature("Murmur", "<p>Hit: 5 (1d6) Slashing damage. ; . The creature hums a strange tune that settles the nerves of all nearby. ... - ,</p>", { keys });
    expect(plan.unrecognized.length).toBeGreaterThan(0);
    for ( const u of plan.unrecognized ) expect(u.text, JSON.stringify(u.text)).toMatch(/[\p{L}\p{N}]/u);
  });
});

describe("thrown range without a unit", () => {
  it("EN 'thrown (range 20/60)' gives 20/60", () => {
    const plan = item("Throwing Knife", "<p>Weapon (dagger), Common. Properties: finesse, light, thrown (range 20/60).</p>", "weapon");
    expect(plan.range).toMatchObject({ value: 20, long: 60 });
  });
});
