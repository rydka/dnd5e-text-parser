// Loads the reference set. Cases with `ref` read their name and HTML from the frozen, versioned file
// fixtures/reference/features-real-texts.json (never from an outside file). A `ref` without text is an error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, "../fixtures/reference");
const REAL_ITEMS = path.resolve(here, "../../../compendium-json-importer/tools/out/items.json");

export const readJson = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));

let realItems = null;
/** @returns {Map<string, object>|null} null when the sibling repository is not available. */
export function loadRealItems() {
  if ( realItems !== null ) return realItems || null;
  try {
    realItems = new Map(JSON.parse(fs.readFileSync(REAL_ITEMS, "utf8")).map(i => [i._id, i]));
  } catch {
    realItems = false;
  }
  return realItems || null;
}

let frozenTexts = null;
const texts = () => (frozenTexts ??= readJson("features-real-texts.json").texts);

/** Resolve `ref` into name and html from the frozen texts. Throws when a ref has no text. */
function resolve(c) {
  if ( !c.ref ) return c;
  const item = texts()[c.ref];
  if ( !item?.html ) throw new Error(`Reference case ${c.id}: ref "${c.ref}" has no text in features-real-texts.json`);
  return { ...c, name: item.name, html: item.html };
}

const resolved = (cases) => cases.map(resolve);

export const loadFeatures = () => [
  ...resolved(readJson("features-real.json").cases),
  ...readJson("features-synthetic.json").cases
];
export const loadObjects = () => resolved(readJson("objects.json").cases);
export const loadSpellcasting = () => resolved(readJson("spellcasting.json").cases);
export const loadSpellcastingNames = () => readJson("spellcasting.json").isSpellcastingName;
export const loadActors = () => readJson("actors.json").cases;
export const loadPartial = () => readJson("partial.json").cases;
export const realAvailable = () => loadRealItems() !== null;
