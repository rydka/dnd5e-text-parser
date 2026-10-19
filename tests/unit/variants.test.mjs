// B9: a conditional or alternative result is a second activity of the same object, never a damage part.
// Texts written for these tests only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `v${++n}`.padEnd(16, "0");
const feature = (name, html) => P.parseFeature(name, html, { keys });
const dice = (parts) => (parts ?? []).map(d => `${d.number}d${d.denomination}${d.bonus ? `${d.bonus > 0 ? "+" : ""}${d.bonus}` : ""} ${d.type ?? "-"}`);
const HEAD = "Melee Attack Roll: +5, reach 5 ft. Hit: ";

describe("variants of a feature", () => {
  it("melee / ranged: the ranged result is a ranged variant", () => {
    const plan = feature("Jab", "<p>Melee or Ranged Attack Roll: +5, reach 5 ft. or range 30/90 ft. Hit: 7 (1d6 + 4) piercing damage in melee or 5 (1d4 + 3) piercing damage at range.</p>");
    expect(dice(plan.damage)).toEqual(["1d6+4 piercing"]);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].attack.type).toBe("ranged");
    expect(dice(plan.variants[0].damage)).toEqual(["1d4+3 piercing"]);
    expect(plan.variants[0].range).toMatchObject({ value: 30, long: 90 });
  });

  it("'in ... form' gives a variant for the other form", () => {
    const plan = feature("Shape Claw", `<p>${HEAD}6 (1d8 + 2) Slashing damage in Small form, or 11 (2d8 + 2) Slashing damage in Large form.</p>`);
    expect(plan.damage.length).toBe(1);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].condition).toMatch(/form/);
    expect(plan.variants[0].damage).toHaveLength(1);
  });

  it("a conditional extra: main part plus the extra in the variant only", () => {
    const plan = feature("Flame Bite", `<p>${HEAD}7 (1d8 + 3) Piercing damage, and the target takes an extra 7 (2d6) Fire damage if it is Bloodied.</p>`);
    expect(dice(plan.damage)).toEqual(["1d8+3 piercing"]);
    expect(plan.variants).toHaveLength(1);
    expect(dice(plan.variants[0].damage)).toEqual(["1d8+3 piercing"]);
    expect(plan.variants[0].extraDamage).toMatchObject({ number: 2, denomination: 6, type: "fire" });
    expect(plan.variants[0].condition).toMatch(/Bloodied/);
  });

  it("'plus ... if' is a variant", () => {
    const plan = feature("Searing Claw", `<p>${HEAD}6 (1d6 + 3) Slashing damage plus 9 (2d8) Radiant damage if the target is a fiend.</p>`);
    expect(dice(plan.damage)).toEqual(["1d6+3 slashing"]);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].extraDamage).toMatchObject({ number: 2, denomination: 8, type: "radiant" });
  });

  it("a conditional save result is a save variant with the same DC", () => {
    const plan = feature("Pyre Burst", "<p>Dexterity Saving Throw: DC 15, each creature in a 10-foot Emanation. Failure: 9 (2d8) Fire damage, or 13 (3d8) Fire damage if the creature is Bloodied. Success: Half damage.</p>");
    expect(dice(plan.save.damage)).toEqual(["2d8 fire"]);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].kind).toBe("save");
    expect(plan.variants[0].save).toMatchObject({ ability: "dex", dc: 15, onSave: "half" });
    expect(dice(plan.variants[0].save.damage)).toEqual(["3d8 fire"]);
  });

  it("toActivities writes the variant as a second activity and the first has a single damage part", () => {
    const plan = feature("Gnaw", `<p>${HEAD}6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the creature is Bloodied.</p>`);
    const activities = P.toActivities(plan, { keys, idGen });
    expect(activities.map(a => a.type)).toEqual(["attack", "attack"]);
    expect(activities[1].name).toMatch(/Bloodied/);
    for ( const a of activities ) expect(a.damage.parts).toHaveLength(1);
    expect(activities[0].damage.parts[0]).toMatchObject({ number: 1, denomination: 8 });
    expect(activities[1].damage.parts[0]).toMatchObject({ number: 2, denomination: 8 });
  });

  it("a conditional extra writes two activities: the base and the base plus extra", () => {
    const plan = feature("Flame Bite", `<p>${HEAD}7 (1d8 + 3) Piercing damage, and the target takes an extra 7 (2d6) Fire damage if it is Bloodied.</p>`);
    const [main, variant] = P.toActivities(plan, { keys, idGen });
    expect(main.damage.parts).toHaveLength(1);
    expect(variant.damage.parts).toHaveLength(2);
  });

  it("control: the two-handed alternative stays ignored", () => {
    const plan = feature("Haft Cut", `<p>${HEAD}6 (1d8 + 2) slashing damage, or 7 (1d10 + 2) slashing damage if used with two hands.</p>`);
    expect(plan.variants ?? []).toEqual([]);
    expect(dice(plan.damage)).toEqual(["1d8+2 slashing"]);
    expect(P.toActivities(plan, { keys, idGen })).toHaveLength(1);
  });
});

describe("variants of an item", () => {
  it("a conditional extra of a weapon is a second attack activity", () => {
    const plan = P.parseItem("Pyre Blade", "<p>Weapon (longsword), Rare. Hit: 8 (1d8 + 4) slashing damage, plus 7 (2d6) fire damage if the target is undead.</p>", { keys, itemType: "weapon" });
    const variants = plan.activities.filter(a => a.condition);
    expect(variants).toHaveLength(1);
    expect(variants[0].extraDamage).toMatchObject({ number: 2, denomination: 6, type: "fire" });
    expect(plan.variants ?? []).toEqual([]);
    expect(JSON.stringify(plan.ambiguous)).toContain("ConditionalDamage");
  });
});

describe("comparator counts variants", () => {
  it("a variant produces a variant token with its attack and damage; the truth form matches it", async () => {
    const { expectedFeatureTokens, producedFeatureTokens, compare } = await import("../support/canon.mjs");
    const html = `<p>${HEAD}6 (1d8 + 2) Piercing damage, or 11 (2d8 + 2) Piercing damage if the creature is Bloodied.</p>`;
    const produced = producedFeatureTokens(feature("Gnaw", html), {});
    expect(produced).toContain("variant=activity");
    expect(produced).toContain("variant.damage=2d8+2 piercing");
    const c = { expected: { attack: ["melee/- +5"], range: ["reach 5"], damage: ["1d8+2 piercing"], variants: [{ damage: ["2d8+2 piercing"] }] } };
    const r = compare(expectedFeatureTokens(c), produced);
    expect(r.wrong).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("ignoring damage also ignores the variant damage", async () => {
    const { expectedFeatureTokens } = await import("../support/canon.mjs");
    const t = expectedFeatureTokens({ ignore: ["damage"], expected: { damage: ["1d8 fire"], variants: [{ damage: ["2d8 fire"] }] } });
    expect(t).toEqual(["variant=activity"]);
  });
});

// Round 2 (B9 follow-up): five more forms. Texts written for these tests only.
describe("B9 follow-up", () => {
  it("a stand-alone sneak attack keeps its damage and gets no variant", () => {
    const plan = feature("Backstab", "<p>Once per turn, the rogue deals an extra 10 (3d6) necrotic damage when it hits a target with a weapon attack and has advantage on the attack roll.</p>");
    expect(dice(plan.damage)).toEqual(["3d6 necrotic"]);
    expect(plan.variants ?? []).toEqual([]);
  });

  it("'— or 2d8+3 piercing plus 1d4 acid damage if' puts the alternative result in the variant", () => {
    const plan = feature("Lurking Maw", `<p>${HEAD}9 (2d6 + 2) Piercing damage—or 14 (3d8 + 1) Piercing plus 3 (1d6) Acid damage if the target is Restrained.</p>`);
    expect(dice(plan.damage)).toEqual(["2d6+2 piercing"]);
    expect(plan.variants).toHaveLength(1);
    const parts = [...plan.variants[0].damage, ...(plan.variants[0].extraDamage ? [plan.variants[0].extraDamage] : [])];
    expect(dice(parts)).toEqual(["3d8+1 piercing", "1d6 acid"]);
  });

  it("'in melee or N piercing at range' without the word damage gives a ranged variant", () => {
    const plan = feature("Hurl", "<p>Melee or Ranged Attack Roll: +6, reach 5 ft. or range 20/60 ft. Hit: 11 (2d8 + 2) piercing damage in melee or 6 (1d8 + 2) piercing at range.</p>");
    expect(dice(plan.damage)).toEqual(["2d8+2 piercing"]);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].attack.type).toBe("ranged");
    expect(dice(plan.variants[0].damage)).toEqual(["1d8+2 piercing"]);
  });

  it("'If the target ..., the target takes an extra N damage and has the Prone condition' is a conditional extra", () => {
    const plan = feature("Trample", `<p>${HEAD}8 (1d10 + 3) Bludgeoning damage. If the target is a Large or smaller creature and the beast moved 20+ feet straight toward it immediately before the hit, the target takes an extra 7 (2d6) Bludgeoning damage and has the Prone condition.</p>`);
    expect(dice(plan.damage)).toEqual(["1d10+3 bludgeoning"]);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].extraDamage).toMatchObject({ number: 2, denomination: 6, type: "bludgeoning" });
    expect(plan.variants[0].condition).toMatch(/moved 20\+ feet/);
  });

  it("a wand variant keeps the activation and the charge consumption of the original activity", () => {
    const plan = P.parseItem("Wand of Embers", "<p>Wand, Rare (Requires Attunement). This wand has 7 charges. As an action, you can expend 1 charge to make a ranged attack roll +5 against a creature within 60 feet. Hit: 7 (2d6) fire damage, plus 4 (1d8) fire damage if the target is undead. The wand regains 1d6 + 1 charges daily at dawn.</p>", { keys, itemType: "equipment" });
    const acts = P.toActivities(plan, { keys, idGen, item: { type: "equipment" }, resolveSpell: () => null });
    const variants = plan.activities.filter(a => a.condition);
    expect(variants.length).toBeGreaterThan(0);
    const base = plan.activities.find(a => !a.condition && a.kind === variants[0].kind);
    expect(base?.consume ?? null).not.toBeNull();
    expect(variants[0].consume).toEqual(base.consume);
    expect(variants[0].activation).toEqual(base.activation);
    expect(acts.filter(a => a.consumption?.targets?.length).length).toBeGreaterThanOrEqual(2);
  });
});
