import * as index from "./index.mjs";

export const MODULE_ID = "dnd5e-text-parser";

/**
 * Build the frozen public API.
 * @returns {Readonly<object>}
 */
export function buildApi() {
  return Object.freeze({ ...index });
}

Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  if ( !module ) return;
  const api = buildApi();
  module.api = api;
  Hooks.callAll(`${MODULE_ID}.ready`, api);
});
