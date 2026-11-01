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
    expect(P.API_VERSION).toMatch(/^\d+\.\d+\.\d+(-v13)?$/);
    expect(P.SCHEMA_VERSION).toBe(1);
  });

  it("P10: API_VERSION equals the module version, 1.1.0-v13 (item-configurator reads only the major)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    expect(P.API_VERSION).toBe("1.1.0-v13");
    expect(manifest.version).toBe(P.API_VERSION);
    expect(Number(P.API_VERSION.split(".")[0])).toBe(1);
  });

  it("P10: toEffectDuration and CHANGE_MODES are exposed by the frozen API", async () => {
    const { buildApi } = await import("../../scripts/module.mjs");
    const api = buildApi();
    expect(Object.isFrozen(api)).toBe(true);
    expect(typeof api.toEffectDuration).toBe("function");
    expect(api.CHANGE_MODES).toEqual({ custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 });
  });

  it("P10: module.json targets Foundry 13 and dnd5e 5.3.0 to 5.99 (C6)", () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    expect(m.version).toBe("1.1.0-v13");
    expect(m.compatibility).toEqual({ minimum: "13", verified: "13" });
    expect(m.relationships.systems).toEqual([{
      id: "dnd5e", type: "system", compatibility: { minimum: "5.3.0", verified: "5.3.3", maximum: "5.99" }
    }]);
    expect(m.library).toBe(true);
  });

  it("P10: manifest is the raw file of the v13 branch, download is the v1.1.0-v13 release", () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    expect(m.manifest).toBe("https://raw.githubusercontent.com/rydka/dnd5e-text-parser/v13/module.json");
    expect(m.download).toBe("https://github.com/rydka/dnd5e-text-parser/releases/download/v1.1.0-v13/module.zip");
  });

  it("P10: the release workflow publishes the v13 branch manifest, not releases/latest", () => {
    const yml = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
    expect(yml).toContain("raw.githubusercontent.com/rydka/dnd5e-text-parser/v13/module.json");
    expect(yml).not.toContain("releases/latest/download/module.json");
  });

  it("the Foundry v13 / dnd5e 5.3.3 globals are what the design asks for", () => {
    expect(game.system.version).toBe("5.3.3");
    expect(game.version).toBe("13.350");
    expect(game.release.generation).toBe(13);
    expect(typeof globalThis._replace).toBe("undefined");
    expect(typeof globalThis._del).toBe("undefined");
  });

  it("no script of the library uses _replace or _del (absent from v13)", () => {
    const offenders = walk(path.join(root, "scripts")).filter(f => /\b_replace\b|\b_del\b/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map(f => path.relative(root, f))).toEqual([]);
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
