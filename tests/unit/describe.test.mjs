// L10: readable descriptions are translated in English and French.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe as suite, expect, it } from "vitest";
import { describe, parseFeature, parseSpellcasting } from "../../scripts/index.mjs";
import { DESCRIBE_KEYS } from "../../scripts/dnd5e/describe.mjs";
import { loadFeatures, loadSpellcasting } from "../support/load.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lang = (code) => JSON.parse(fs.readFileSync(path.join(root, "lang", `${code}.json`), "utf8"));

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === "object") ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
}
const en = new Map(flatten(lang("en")));
const fr = new Map(flatten(lang("fr")));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

suite("L10: lang files", () => {
  it("en and fr have exactly the same keys", () => {
    expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it("no empty value", () => {
    for ( const [k, v] of [...en, ...fr] ) expect(String(v).trim().length, k).toBeGreaterThan(0);
  });

  it("en and fr use the same placeholders for each key", () => {
    for ( const [k, v] of en ) expect(placeholders(fr.get(k)), k).toEqual(placeholders(v));
  });

  it("the French text is really translated (differs from English) for most keys", () => {
    const same = [...en].filter(([k, v]) => fr.get(k) === v).map(([k]) => k);
    expect(same.length).toBeLessThanOrEqual(Math.floor(en.size * 0.15));
  });

  it("every key emitted by describe is declared and exists in en and fr", () => {
    expect(DESCRIBE_KEYS.length).toBeGreaterThan(10);
    for ( const key of DESCRIBE_KEYS ) {
      expect(en.has(key), `en: ${key}`).toBe(true);
      expect(fr.has(key), `fr: ${key}`).toBe(true);
    }
  });
});

suite("L10: describe output", () => {
  const plans = [
    ...loadFeatures().map(c => parseFeature(c.name, c.html)),
    ...loadSpellcasting().map(c => parseSpellcasting(c.html)).filter(Boolean)
  ];

  it("every key emitted for the reference plans exists in en and fr, with its variables provided", () => {
    const seen = new Set();
    for ( const plan of plans ) {
      for ( const d of describe(plan) ) {
        seen.add(d.key);
        expect(en.has(d.key), `en: ${d.key}`).toBe(true);
        expect(fr.has(d.key), `fr: ${d.key}`).toBe(true);
        for ( const name of placeholders(en.get(d.key)) ) expect(d.data, `${d.key} needs ${name}`).toHaveProperty(name);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("descriptors are neutral objects { key, data, group, raw, origin, paths } (no localized string)", () => {
    const plan = parseFeature("Bite", "<p>Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage.</p>");
    const list = describe(plan);
    expect(list.length).toBeGreaterThan(2);
    for ( const d of list ) {
      expect(Object.keys(d).sort()).toEqual(["data", "group", "key", "origin", "paths", "raw"]);
      expect([null, "details", "activities", "effects"]).toContain(d.group);
      expect(["rules", "fallback"]).toContain(d.origin);
      expect(Array.isArray(d.paths)).toBe(true);
      expect(typeof d.raw === "string" || d.raw == null).toBe(true);
      expect(d.key.startsWith("dnd5e-text-parser.")).toBe(true);
    }
  });

  it("the changes of a merge are described with the Field key", () => {
    const list = describe([{ path: "range.value", value: 5 }]);
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe("dnd5e-text-parser.Describe.Field");
    expect(list[0].data).toMatchObject({ path: "range.value", value: 5 });
  });

  it("the same plan is described identically twice (deterministic)", () => {
    const plan = parseFeature("Bite", "<p>+5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage.</p>");
    expect(describe(plan)).toEqual(describe(plan));
  });
});
