// L5: the "empty fields only" merge never modifies a filled value and reports what it filled.
import { describe, expect, it } from "vitest";
import { isEmpty, isEmptyUtility, mergeMissing } from "../../scripts/index.mjs";
import { loadPartial } from "../support/load.mjs";

const cases = loadPartial();

const leaves = (value, prefix = "") => {
  if ( value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length ) {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [[prefix, value]];
};
const normPath = (p) => p.replace(/\[(\d+)\]/g, ".$1");

describe("isEmpty", () => {
  it.each([[undefined], [null], [""], [[]], [{}]])("%j is empty", (v) => expect(isEmpty(v)).toBe(true));
  it.each([[0], [false], ["a"], [[0]], [{ a: 1 }], [{ a: undefined }], [" "]])("%j is not empty", (v) => expect(isEmpty(v)).toBe(false));
});

describe("L5: mergeMissing on partial.json", () => {
  it("the reference set has at least 20 cases", () => expect(cases.length).toBeGreaterThanOrEqual(20));

  it.each(cases.map(c => [c.id, c]))("%s", (_id, c) => {
    const target = structuredClone(c.target);
    const patch = structuredClone(c.patch);
    const filled = mergeMissing(target, patch, c.options ?? {});
    expect(target).toEqual(c.expected);
    expect(filled.map(f => normPath(f.path)).sort()).toEqual([...c.filled].sort());
    expect(patch).toEqual(c.patch);
  });

  it("0 non-empty leaf modified, over every case", () => {
    let modified = 0, checked = 0;
    for ( const c of cases ) {
      const zero = new Set(c.options?.zeroIsEmpty ?? []);
      const target = structuredClone(c.target);
      mergeMissing(target, structuredClone(c.patch), c.options ?? {});
      for ( const [p, v] of leaves(c.target) ) {
        if ( isEmpty(v) || (v === 0 && zero.has(p)) ) continue;
        checked++;
        const after = p.split(".").reduce((o, k) => o?.[k], target);
        if ( JSON.stringify(after) !== JSON.stringify(v) ) modified++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15);
    expect(modified).toBe(0);
  });

  it("each reported change carries the value that was written", () => {
    const filled = mergeMissing({ a: {} }, { a: { b: 1, c: "x" } });
    expect(filled).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 1 }), expect.objectContaining({ value: "x" })
    ]));
  });

  it("merging the same patch twice fills nothing the second time", () => {
    const target = {};
    const patch = { range: { value: 5, units: "ft" }, uses: { max: "3" } };
    expect(mergeMissing(target, patch).length).toBe(3);
    expect(mergeMissing(target, patch)).toEqual([]);
  });
});

describe("isEmptyUtility", () => {
  const base = () => ({
    type: "utility", name: "Slam",
    activation: { type: "action", value: 1, condition: "" },
    roll: { formula: "", name: "", prompt: false, visible: false }
  });

  it("an empty utility (only a name and an activation) is convertible", () => {
    expect(isEmptyUtility(base())).toBe(true);
  });

  it.each([
    ["a roll formula", (a) => { a.roll.formula = "1d6"; }],
    ["an effect", (a) => { a.effects = [{ _id: "x" }]; }],
    ["a consumption target", (a) => { a.consumption = { targets: [{ type: "itemUses" }] }; }],
    ["a uses max", (a) => { a.uses = { max: "3" }; }],
    ["a range value", (a) => { a.range = { value: 5, units: "ft" }; }],
    ["a template type", (a) => { a.target = { template: { type: "cone" } }; }],
    ["an affects type", (a) => { a.target = { affects: { type: "creature" } }; }],
    ["an affects count", (a) => { a.target = { affects: { count: "1" } }; }]
  ])("is not empty with %s", (_label, mutate) => {
    const a = base();
    mutate(a);
    expect(isEmptyUtility(a)).toBe(false);
  });

  it("only utility activities qualify", () => {
    for ( const type of ["attack", "save", "damage", "heal"] ) expect(isEmptyUtility({ ...base(), type })).toBe(false);
  });
});
