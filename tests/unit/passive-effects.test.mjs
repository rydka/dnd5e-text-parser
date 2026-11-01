// C26: effects of passive creature features (parseFeature -> plan.effects, toEffects(featurePlan)). EN and FR.
// Texts written for these tests only. The keys snapshot predates `senses`, so it is completed here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8"));
const keys = P.keysFromConfig({ ...snapshot, senses: { darkvision: {}, blindsight: {}, tremorsense: {}, truesight: {} } });
const idGen = () => "p".repeat(16);
const feature = (name, html) => P.parseFeature(name, html, { keys });
// v13: `mode` is numeric; the readable name keeps the expectations legible
const MODE_NAME = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
const changes = (plan, name = "Trait") => P.toEffects(plan, { keys, idGen, name }).flatMap(e => e.changes.map(c => `${c.key}|${MODE_NAME[c.mode]}|${c.value}`));
const noteKeys = (plan) => plan.notes.map(n => n.key.split(".").pop());

describe("damage reduction", () => {
  it("EN: three types, no bypass", () => {
    const plan = feature("Iron Hide", "<p>The statue reduces all incoming bludgeoning, piercing, and slashing damage by 5.</p>");
    expect(plan.effects.map(e => `${e.kind}|${e.scope}|${e.value}`)).toEqual(["damageReduction|bludgeoning|5", "damageReduction|piercing|5", "damageReduction|slashing|5"]);
    const got = changes(plan);
    for ( const t of ["bludgeoning", "piercing", "slashing"] ) expect(got).toContain(`system.traits.dm.amount.${t}|add|-5`);
    expect(got.some(c => c.includes("dm.bypasses"))).toBe(false);
  });

  it("EN: the nonmagical variant writes dm.bypasses mgc once", () => {
    const plan = feature("Hardened Plates", "<p>Bludgeoning, piercing, and slashing damage that the sentinel takes from nonmagical attacks is reduced by 2.</p>");
    const got = changes(plan);
    for ( const t of ["bludgeoning", "piercing", "slashing"] ) expect(got).toContain(`system.traits.dm.amount.${t}|add|-2`);
    expect(got.filter(c => c === "system.traits.dm.bypasses|add|mgc")).toHaveLength(1);
  });

  it("FR: three types", () => {
    const plan = feature("Carapace", "<p>La statue réduit de 4 les dégâts contondants, perforants et tranchants qu'elle subit.</p>");
    const got = changes(plan);
    for ( const t of ["bludgeoning", "piercing", "slashing"] ) expect(got).toContain(`system.traits.dm.amount.${t}|add|-4`);
  });

  it("FR: nonmagical attacks write dm.bypasses mgc", () => {
    const plan = feature("Plaques durcies", "<p>Les dégâts contondants, perforants et tranchants subis par la sentinelle d'attaques non magiques sont réduits de 2.</p>");
    expect(changes(plan)).toContain("system.traits.dm.bypasses|add|mgc");
  });

  it("the effect is one transferred effect", () => {
    const plan = feature("Iron Hide", "<p>The statue reduces all incoming bludgeoning, piercing, and slashing damage by 5.</p>");
    const effects = P.toEffects(plan, { keys, idGen, name: "Iron Hide" });
    expect(effects).toHaveLength(1);
    expect(effects[0].transfer).toBe(true);
  });
});

describe("darkvision", () => {
  it("EN", () => {
    expect(changes(feature("Night Eyes", "<p>The owl has darkvision out to a range of 90 feet.</p>"))).toEqual(["system.attributes.senses.ranges.darkvision|upgrade|90"]);
  });
  it("FR (meters converted)", () => {
    expect(changes(feature("Yeux nocturnes", "<p>La chouette possède une vision dans le noir sur 27 m.</p>"))).toEqual(["system.attributes.senses.ranges.darkvision|upgrade|90"]);
  });
});

describe("resistance and condition immunity in one sentence", () => {
  it("EN", () => {
    const got = changes(feature("Grave Ward", "<p>The wight has resistance to cold damage and is immune to the charmed condition.</p>"));
    expect(got).toContain("system.traits.dr.value|add|cold");
    expect(got).toContain("system.traits.ci.value|add|charmed");
  });
  it("FR", () => {
    const got = changes(feature("Garde tombale", "<p>Le revenant a la résistance aux dégâts de froid et est immunisé contre l'état charmé.</p>"));
    expect(got).toContain("system.traits.dr.value|add|cold");
    expect(got).toContain("system.traits.ci.value|add|charmed");
  });
});

describe("armor class increase", () => {
  it("EN", () => {
    expect(changes(feature("Bulwark", "<p>The guardian's AC increases by 3.</p>"))).toEqual(["system.attributes.ac.bonus|add|+3"]);
  });
  it("FR", () => {
    expect(changes(feature("Rempart", "<p>La CA du gardien augmente de 3.</p>"))).toEqual(["system.attributes.ac.bonus|add|+3"]);
  });
});

describe("what dnd5e cannot apply gives NotAutomated and no effect", () => {
  const cases = [
    ["EN advantage against spells", "Spell Ward", "<p>The wizard has advantage on saving throws against spells.</p>"],
    ["FR advantage against spells", "Garde des sorts", "<p>Le mage a l'avantage aux jets de sauvegarde contre les sorts.</p>"],
    ["EN while in sunlight", "Sun Dread", "<p>While in sunlight, the ghoul has disadvantage on attack rolls.</p>"],
    ["FR while in sunlight", "Crainte du soleil", "<p>Tant qu'il est en plein soleil, le goule a un désavantage aux jets d'attaque.</p>"],
    ["EN aura on nearby creatures", "Dread Aura", "<p>Each creature within 15 feet of the banshee has disadvantage on saving throws.</p>"],
    ["FR aura on nearby creatures", "Aura d'effroi", "<p>Chaque créature à moins de 4,50 mètres de la banshee a un désavantage aux jets de sauvegarde.</p>"],
    ["EN reduced to 1 hit point", "Stubborn Husk", "<p>If damage reduces the husk to 0 hit points, it is reduced to 1 hit point instead.</p>"],
    ["FR reduced to 1 hit point", "Carcasse obstinée", "<p>Si des dégâts réduisent la carcasse à 0 point de vie, elle est réduite à 1 point de vie à la place.</p>"]
  ];
  for ( const [label, name, html] of cases ) {
    it(label, () => {
      const plan = feature(name, html);
      expect(plan.effects).toEqual([]);
      expect(noteKeys(plan)).toContain("NotAutomated");
      expect(plan.unrecognized).toEqual([]);
      expect(P.toEffects(plan, { keys, idGen, name })).toEqual([]);
    });
  }
});

describe("a feature with an activation gets no passive effect", () => {
  it("an attack that also states a resistance", () => {
    const plan = feature("Fiery Claw", "<p>Melee Attack Roll: +5, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage. The creature has resistance to fire damage.</p>");
    expect(plan.effects).toEqual([]);
    expect(P.toEffects(plan, { keys, idGen, name: "Fiery Claw" })).toEqual([]);
  });
  it("a save feature that also states a resistance", () => {
    const plan = feature("Frost Pulse", "<p>Dexterity Saving Throw: DC 14, each creature in a 10-foot Emanation. Failure: 9 (2d8) Cold damage. The golem has resistance to cold damage.</p>");
    expect(plan.effects).toEqual([]);
  });
  it("opts.featureEffects false leaves effects empty", () => {
    const plan = P.parseFeature("Iron Hide", "<p>The statue reduces all incoming bludgeoning, piercing, and slashing damage by 5.</p>", { keys, featureEffects: false });
    expect(plan.effects).toEqual([]);
  });
});
