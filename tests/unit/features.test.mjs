// L2 (one test per reference case, EN and FR) and L3 (no invented fact) for parseFeature.
import { describe, expect, it } from "vitest";
import { parseFeature } from "../../scripts/index.mjs";
import { loadFeatures } from "../support/load.mjs";
import { compare, expectedFeatureTokens, producedFeatureTokens } from "../support/canon.mjs";

const cases = loadFeatures();
const byLang = (lang) => cases.filter(c => c.lang === lang);
const tagged = (tag) => cases.filter(c => c.tags?.includes(tag)).map(c => [c.id, c]);

describe.each(["en", "fr"])("L2: formulations (%s)", (lang) => {
  it.each(byLang(lang).map(c => [c.id, c]))("%s", (_id, c) => {
    const plan = parseFeature(c.name, c.html);
    const result = compare(expectedFeatureTokens(c), producedFeatureTokens(plan, c));
    expect({ missing: result.missing, wrong: result.wrong }).toEqual({ missing: [], wrong: [] });
  });
});

describe("L3: ambiguity and unrecognized text", () => {
  it.each(cases.filter(c => c.expectAmbiguous).map(c => [c.id, c]))("%s is rendered as ambiguous with its passage", (_id, c) => {
    const plan = parseFeature(c.name, c.html);
    expect(plan.ambiguous.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan.ambiguous)).toMatch(/to hit|au toucher|saving throw|jet de sauvegarde/);
  });

  it.each(tagged("save-ambiguous"))("%s: no save is invented", (_id, c) => {
    expect(parseFeature(c.name, c.html).save).toBeNull();
  });

  it.each(tagged("attack-ambiguous"))("%s: no attack is invented", (_id, c) => {
    expect(parseFeature(c.name, c.html).attack).toBeNull();
  });

  it.each(cases.filter(c => c.tags?.includes("L3") && c.tags?.includes("negative")).map(c => [c.id, c]))(
    "%s: nothing recognized, the sentences are listed with their text", (_id, c) => {
      const plan = parseFeature(c.name, c.html);
      expect(producedFeatureTokens(plan, c)).toEqual([]);
      expect(plan.unrecognized.length).toBeGreaterThan(0);
      for ( const u of plan.unrecognized ) {
        expect(typeof u.text).toBe("string");
        expect(u.text.length).toBeGreaterThan(0);
        expect(typeof u.index).toBe("number");
      }
      expect(plan.unrecognized.map(u => u.text).join(" ")).toMatch(/regain|regagne/i);
    });

  it("negative abilities produce no attack, save, damage, template, uses or recharge", () => {
    const negatives = cases.filter(x => x.tags?.includes("negative") && Object.keys(x.expected).every(k => k === "activation"));
    expect(negatives.length).toBeGreaterThan(10);
    for ( const c of negatives ) {
      const plan = parseFeature(c.name, c.html);
      expect(plan.attack, c.id).toBeNull();
      expect(plan.save, c.id).toBeNull();
      expect(plan.damage, c.id).toEqual([]);
      expect(plan.template, c.id).toBeNull();
      expect(plan.uses, c.id).toBeNull();
      expect(plan.recharge, c.id).toBeNull();
    }
  });

  it("empty text yields an empty plan, never an exception", () => {
    for ( const html of ["", "   ", "<p></p>", "<p>&nbsp;</p>"] ) {
      const plan = parseFeature("Nothing", html);
      expect(plan.attack).toBeNull();
      expect(plan.damage).toEqual([]);
      expect(plan.save).toBeNull();
    }
  });

  it("an unknown damage type gives a part without type and a note, not an invented key", () => {
    const c = cases.find(x => x.id === "s-en-unknown-damage-type");
    const plan = parseFeature(c.name, c.html);
    expect(plan.damage[0].type ?? null).toBeNull();
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  it("damage parts keep the raw passage", () => {
    const c = cases.find(x => x.id === "s-en-chain-plus");
    const plan = parseFeature(c.name, c.html);
    expect(plan.damage).toHaveLength(2);
    for ( const part of plan.damage ) expect(part.raw.length).toBeGreaterThan(0);
  });

  it("Legendary Resistance is not filed as a legendary action (C12)", () => {
    const legres = cases.filter(x => x.expected?.legendaryResistance != null);
    expect(legres.length).toBeGreaterThan(4);
    for ( const c of legres ) expect(parseFeature(c.name, c.html).activation?.type, c.id).not.toBe("legendary");
  });

  it("the languages option restricts the pattern sets", () => {
    const fr = cases.find(x => x.id === "s-fr-bite-weapon");
    expect(parseFeature(fr.name, fr.html).attack?.bonus).toBe(5);
    expect(parseFeature(fr.name, fr.html, { languages: ["en"] }).attack).toBeNull();
  });

  it("meters are converted to feet", () => {
    const c = cases.find(x => x.id === "s-fr-range-half-meters");
    expect(parseFeature(c.name, c.html).range).toMatchObject({ value: 25, long: 75 });
  });
});
