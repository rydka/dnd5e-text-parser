// creature-header review fixes: no catastrophic backtracking, thousands separators in hit points.
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const time = fn => { const t = performance.now(); const result = fn(); return { ms: performance.now() - t, result }; };

describe("regression: parsing time on pathological input", () => {
  it("parseStatLines on a long run of ability abbreviations stays under 100 ms", () => {
    expect(time(() => P.parseStatLines("str dex con int wis ".repeat(150))).ms).toBeLessThan(100);
  });
  it("parseSaves on 50000 characters stays under 100 ms", () => {
    expect(time(() => P.parseSaves("a".repeat(50000))).ms).toBeLessThan(100);
  });
  it("parseSkills on 50000 characters stays under 100 ms", () => {
    expect(time(() => P.parseSkills("a".repeat(50000))).ms).toBeLessThan(100);
  });
  it("the real ability row is still recognized", () => {
    const stats = P.parseStatLines("STR DEX CON INT WIS CHA\n18 (+4) 12 (+1) 18 (+4) 10 (+0) 14 (+2) 12 (+1)");
    expect(stats.abilities).toMatchObject({ str: 18, dex: 12, con: 18, int: 10, wis: 14, cha: 12 });
  });
});

describe("regression: parseHp thousands separators", () => {
  it.each(["1,200 (96d20)", "1 200", "1.200"])("%s gives 1200", text => {
    expect(P.parseHp(text)?.value).toBe(1200);
  });
  it("1,20 gives null", () => expect(P.parseHp("1,20")).toBeNull());
});
