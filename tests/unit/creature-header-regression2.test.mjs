// creature-header third review pass: negative bonus glued to a name, space-grouped thousands in hit points.
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

describe("regression: negative bonus glued to a name", () => {
  it("parseSaves", () => {
    expect(P.parseSaves("Dex-1")).toEqual({ dex: -1 });
    expect(P.parseSaves("Dex -1, Wis+3")).toEqual({ dex: -1, wis: 3 });
  });
  it("parseSkills reads Stealth-1 and Sleight of Hand-2", () => {
    expect(P.parseSkills("Stealth-1")).toEqual({ ste: 1 });
    expect(P.parseSkills("Sleight of Hand-2")).toEqual({ slt: 1 });
  });
  it("compound names stay intact", () => {
    expect(P.parseSkills("Sleight of Hand +5, Animal Handling +3")).toEqual({ slt: 1, ani: 1 });
    expect(P.parseSkills("Sleight of Hand-2, Stealth +4")).toEqual({ slt: 1, ste: 1 });
  });
});

describe("regression: parseHp space-grouped thousands", () => {
  it.each([
    ["45 300 ft", 45],
    ["58 (9d8 + 18) Speed 30 ft.", 58],
    ["1 200 (96d20)", 1200]
  ])("%s gives %i", (text, value) => expect(P.parseHp(text)?.value).toBe(value));
  it.each(["1,2000", "12.5 (2d8)"])("%s gives null", text => expect(P.parseHp(text)).toBeNull());
});
