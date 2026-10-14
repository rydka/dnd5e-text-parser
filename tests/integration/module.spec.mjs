import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const MODULE_ID = "dnd5e-text-parser";

test("L8: the API is frozen, versioned, and identical to the ES import", async ({ foundry }, testInfo) => {
  const state = await foundry(async (id) => {
    const mod = game.modules.get(id);
    const api = mod?.api;
    const es = await import(`/modules/${id}/scripts/index.mjs`);
    const names = ["parseFeature", "parseItem", "parseActor", "parseSpellcasting", "toActivities", "toEffects", "toItemPatch", "toActorPatch", "mergeMissing", "describe", "registerFallback", "keysFromConfig", "keysSnapshot", "parseItemAsync", "parseFeatureAsync", "validateFallbackFacts"];
    return {
      active: mod?.active ?? false,
      frozen: Object.isFrozen(api),
      apiVersion: api?.API_VERSION,
      schemaVersion: api?.SCHEMA_VERSION,
      esVersion: es.API_VERSION,
      missing: names.filter(n => typeof api?.[n] !== "function"),
      sameFunctions: names.every(n => api?.[n] === es[n]),
      stillFunction: (() => { try { api.parseFeature = null; } catch { /* frozen */ } return typeof api?.parseFeature === "function"; })()
    };
  }, MODULE_ID);
  fs.writeFileSync(testInfo.outputPath("L8-api.json"), JSON.stringify(state, null, 1));
  expect(state.active).toBe(true);
  expect(state.frozen).toBe(true);
  expect(state.apiVersion).toMatch(/^\d+\.\d+\.\d+$/);
  expect(state.esVersion).toBe(state.apiVersion);
  expect(state.schemaVersion).toBe(1);
  expect(state.missing).toEqual([]);
  expect(state.sameFunctions).toBe(true);
  expect(state.stillFunction).toBe(true);
});

test("no errors are logged while the world loads", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  await page.goto("/game");
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  expect(errors.filter((e) => e.includes(MODULE_ID))).toEqual([]);
});
