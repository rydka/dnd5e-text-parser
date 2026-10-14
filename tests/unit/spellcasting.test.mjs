// L2 for spell lists (Spellcasting / Innate Spellcasting / Incantation), EN and FR; L3 for non-spellcasting text.
import { describe, expect, it } from "vitest";
import { parseSpellcasting } from "../../scripts/index.mjs";
import { isSpellcastingName } from "../../scripts/parse/spellcasting.mjs";
import { loadSpellcasting, loadSpellcastingNames } from "../support/load.mjs";
import { compare, expectedSpellTokens, spellTokens } from "../support/canon.mjs";

const cases = loadSpellcasting();

describe.each(["en", "fr"])("L2: spell lists (%s)", (lang) => {
  it.each(cases.filter(c => c.lang === lang && c.expected).map(c => [c.id, c]))("%s", (_id, c) => {
    const result = compare(expectedSpellTokens(c), spellTokens(parseSpellcasting(c.html), c));
    expect({ missing: result.missing, wrong: result.wrong }).toEqual({ missing: [], wrong: [] });
  });
});

describe("trait names", () => {
  const names = loadSpellcastingNames();
  it.each(names.true.map(n => [n]))("%s is a spellcasting trait", (n) => expect(isSpellcastingName(n)).toBe(true));
  it.each(names.false.map(n => [n]))("'%s' is not", (n) => expect(isSpellcastingName(n)).toBe(false));
});

describe("L3: not spellcasting", () => {
  it.each(cases.filter(c => c.expected === null).map(c => [c.id, c]))("%s returns null", (_id, c) => {
    expect(parseSpellcasting(c.html)).toBeNull();
  });
});
