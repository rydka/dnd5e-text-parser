// L1 (pure, deterministic, no Foundry global) and the shape of the public API (L8, unit part).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../../scripts/index.mjs";
import { loadFeatures, loadActors, loadSpellcasting } from "../support/load.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith(".mjs") ? [path.join(dir, e.name)] : []));
}

describe("public API (L8, unit part)", () => {
  it("exposes the versions", () => {
    expect(P.API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(P.SCHEMA_VERSION).toBe(1);
  });

  it("API_VERSION matches the module version (without pre-release suffix)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    expect(manifest.version.split("-")[0]).toBe(P.API_VERSION);
  });

  it.each([
    "parseFeature", "parseActor", "parseSpellcasting", "nameKey",
    "htmlToText", "splitSentences", "splitLines", "toFeet", "toPounds",
    "toActivities", "toItemPatch", "toActorPatch", "toSpellStubs",
    "isEmpty", "isEmptyUtility", "mergeMissing", "keysFromConfig", "describe",
    "registerFallback", "getFallback"
  ])("exports %s as a function", (name) => {
    expect(typeof P[name]).toBe("function");
  });

  it("plans carry the schema version", () => {
    expect(P.parseFeature("Bite", "<p>+5 to hit, reach 5 ft., one target.</p>").schema).toBe(P.SCHEMA_VERSION);
  });
});

describe("L1: pure and deterministic", () => {
  it("scripts/parse and scripts/dnd5e reference no Foundry global", () => {
    const forbidden = /(?<![\w.$])(game|canvas|ui|Hooks|CONFIG|foundry|ChatMessage|fromUuid|fromUuidSync)\s*(\.|\()/;
    const offenders = [];
    for ( const file of [...walk(path.join(root, "scripts/parse")), ...walk(path.join(root, "scripts/dnd5e"))] ) {
      const code = fs.readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
        .replace(/"(?:\\.|[^"\\])*"/g, "\"\"").replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
      code.split("\n").forEach((line, i) => {
        if ( forbidden.test(line) ) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("importing scripts/index.mjs registers no hook", async () => {
    const before = globalThis.Hooks?.on?.mock?.calls?.length ?? 0;
    await import("../../scripts/index.mjs");
    expect(globalThis.Hooks?.on?.mock?.calls?.length ?? 0).toBe(before);
  });

  it("two identical calls return deeply equal results, and the input is not modified", () => {
    for ( const c of loadFeatures().slice(0, 40) ) {
      const frozen = structuredClone(c);
      const a = P.parseFeature(c.name, c.html);
      const b = P.parseFeature(c.name, c.html);
      expect(b, c.id).toEqual(a);
      expect(c).toEqual(frozen);
    }
    for ( const c of loadSpellcasting() ) {
      expect(P.parseSpellcasting(c.html), c.id).toEqual(P.parseSpellcasting(c.html));
    }
  });

  it("parseActor is deterministic and leaves the actor source untouched", () => {
    for ( const c of loadActors() ) {
      const before = structuredClone(c.actor);
      const a = P.parseActor(c.actor);
      const b = P.parseActor(structuredClone(c.actor));
      expect(a, c.id).toEqual(b);
      expect(c.actor).toEqual(before);
    }
  });

  it("never reads the clock or Math.random", () => {
    const random = Math.random, now = Date.now;
    Math.random = () => { throw new Error("Math.random used"); };
    Date.now = () => { throw new Error("Date.now used"); };
    try {
      for ( const c of loadFeatures().slice(0, 20) ) P.parseFeature(c.name, c.html);
    } finally {
      Math.random = random;
      Date.now = now;
    }
  });
});
