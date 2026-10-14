import js from "@eslint/js";
import globals from "globals";

const foundryGlobals = {
  game: "readonly",
  ui: "readonly",
  canvas: "readonly",
  CONFIG: "readonly",
  CONST: "readonly",
  Hooks: "readonly",
  foundry: "readonly",
  dnd5e: "readonly",
  fromUuid: "readonly",
  fromUuidSync: "readonly",
  ChatMessage: "readonly",
  Roll: "readonly"
};

// Pure library code: no Foundry (or browser) global allowed, only ECMAScript built-ins.
const pure = ["scripts/parse/**/*.mjs", "scripts/dnd5e/**/*.mjs", "scripts/index.mjs", "scripts/registry.mjs"];

export default [
  { ignores: [".atelier/**"] },
  js.configs.recommended,
  {
    files: ["scripts/module.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...foundryGlobals }
    }
  },
  {
    files: pure,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {}
    }
  },
  {
    // The fallback pass needs the ECMAScript-adjacent timers and AbortController (Node and browsers)
    files: ["scripts/parse/fallback.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { AbortController: "readonly", setTimeout: "readonly", clearTimeout: "readonly" }
    }
  },
  {
    files: ["tests/**/*.{js,mjs}", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...foundryGlobals }
    }
  }
];
