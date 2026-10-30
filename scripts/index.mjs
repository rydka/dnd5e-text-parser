/**
 * Public API of dnd5e-text-parser (pure, no side effect at import, no Foundry global).
 *
 *   import * as parser from "/modules/dnd5e-text-parser/scripts/index.mjs";   // in Foundry
 *   import * as parser from "dnd5e-text-parser";                               // in Node (file: dependency)
 *
 * Also exposed at runtime as `game.modules.get("dnd5e-text-parser").api` (frozen).
 */

/** Semver of the API; equals the module version. Major: removal or signature change, or incompatible plan change. */
export const API_VERSION = "1.1.0";

/** Version of the intermediate structure; written in each plan as `plan.schema`. */
export const SCHEMA_VERSION = 1;

export { parseFeature, parseItem, parseActor, nameKey } from "./parse/plan.mjs";
export { parseSpellcasting } from "./parse/spellcasting.mjs";
export {
  parseStatLines, parseSizeLine, parseAc, parseHp, parseSpeed, parseAbilities, parseChallenge, parseSenses,
  parseLanguages, parseSaves, parseSkills
} from "./parse/stat-lines.mjs";
export { toNpcPatch } from "./dnd5e/npc.mjs";
export { parseFeatureAsync, parseItemAsync, validateFallbackFacts } from "./parse/fallback.mjs";
export { htmlToText, splitSentences, splitLines, toFeet, toPounds } from "./parse/text.mjs";
export { toActivities, toDamagePart } from "./dnd5e/activities.mjs";
export { toEffects } from "./dnd5e/effects.mjs";
export { toItemPatch } from "./dnd5e/item.mjs";
export { toActorPatch, toSpellStubs } from "./dnd5e/actor.mjs";
export { isEmpty, isEmptyUtility, mergeMissing } from "./dnd5e/merge.mjs";
export { keysFromConfig, keysSnapshot } from "./dnd5e/keys.mjs";
export { describe } from "./dnd5e/describe.mjs";
export { registerFallback, getFallback } from "./registry.mjs";
