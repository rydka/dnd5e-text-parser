// creature-header: edge cases of keys.mjs (language tree) and npc.mjs (initiative, swarm, languages, sense rounding).
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const tree = {
  standard: { label: "Standard", selectable: false, children: { common: "Common", goblin: "Goblin" } },
  exotic: {
    label: "Exotic", selectable: false,
    children: { primordial: { label: "Primordial", children: { aquan: "Aquan" } }, abyssal: "Abyssal" }
  },
  cant: "Thieves' Cant"
};
const keys = P.keysFromConfig({
  abilities: { str: "", dex: "" }, senses: { darkvision: "", blindsight: "" }, movementTypes: { walk: "" },
  actorSizes: { med: "", tiny: "" }, creatureTypes: { humanoid: "", beast: "" }, languages: tree
});

describe("keysFromConfig: languages tree", () => {
  it("keeps leaves and selectable parents, drops non-selectable categories", () => {
    expect([...keys.languages].sort()).toEqual(["abyssal", "aquan", "cant", "common", "goblin", "primordial"]);
  });
  it("flat languages table and list still work", () => {
    expect([...P.keysFromConfig({ languages: { a: "A", b: "B" } }).languages].sort()).toEqual(["a", "b"]);
    expect([...P.keysFromConfig({ languages: ["a", "b"] }).languages].sort()).toEqual(["a", "b"]);
  });
});

describe("toNpcPatch: initiative (2024)", () => {
  const mk = (bonus, dex) => ({ initiative: { bonus }, abilities: dex === undefined ? {} : { dex } });
  it("only the surplus over the Dex modifier is written", () => {
    const { system } = P.toNpcPatch(mk(5, 14), { keys });
    expect(system.attributes.init).toEqual({ bonus: "3" });
  });
  it("nothing written when the bonus equals the Dex modifier", () => {
    const { system, notes } = P.toNpcPatch(mk(2, 14), { keys });
    expect(system.attributes?.init).toBeUndefined();
    expect(notes).toEqual([]);
  });
  it("negative surplus is kept", () => {
    expect(P.toNpcPatch(mk(0, 14), { keys }).system.attributes.init).toEqual({ bonus: "-2" });
  });
  it("without Dex: nothing written and an InitiativeSkipped note", () => {
    const { system, notes } = P.toNpcPatch(mk(4), { keys });
    expect(system.attributes?.init).toBeUndefined();
    expect(notes).toEqual([{ key: "dnd5e-text-parser.Note.InitiativeSkipped", data: { bonus: 4 } }]);
  });
});

describe("toNpcPatch: swarm, languages, rounding", () => {
  it("invalid swarm size: empty swarm and NpcKeyInvalid note", () => {
    const { system, notes } = P.toNpcPatch({ size: { size: "med", type: "beast", swarm: "huge" } }, { keys });
    expect(system.details.type.swarm).toBe("");
    expect(notes).toContainEqual({ key: "dnd5e-text-parser.Note.NpcKeyInvalid", data: { field: "swarm", value: "huge" } });
  });
  it("valid swarm size is kept", () => {
    const { system } = P.toNpcPatch({ size: { size: "med", type: "beast", swarm: "tiny" } }, { keys });
    expect(system.details.type.swarm).toBe("tiny");
  });
  it("unknown language goes to custom with a note; tree leaves are valid", () => {
    const { system, notes } = P.toNpcPatch({ languages: { value: ["aquan", "elvish"], custom: "Sylvan-ish" } }, { keys });
    expect(system.traits.languages.value).toEqual(["aquan"]);
    expect(system.traits.languages.custom).toBe("Sylvan-ish; elvish");
    expect(notes).toContainEqual({ key: "dnd5e-text-parser.Note.NpcKeyInvalid", data: { field: "languages", value: "elvish" } });
  });
  it("metric sense ranges are rounded to integers with RangeRounded", () => {
    const { system, notes } = P.toNpcPatch({ senses: { ranges: { darkvision: 60, blindsight: 25 }, special: "" } }, { keys, metric: true });
    expect(system.attributes.senses.ranges).toEqual({ darkvision: 18, blindsight: 8 });
    expect(Number.isInteger(system.attributes.senses.ranges.blindsight)).toBe(true);
    expect(notes).toContainEqual({ key: "dnd5e-text-parser.Note.RangeRounded", data: { field: "senses.blindsight", from: 7.5, to: 8 } });
    expect(notes.filter(n => n.key.endsWith("RangeRounded"))).toHaveLength(1);
  });
  it("imperial sense ranges: no rounding note", () => {
    const { notes } = P.toNpcPatch({ senses: { ranges: { darkvision: 60 } } }, { keys });
    expect(notes).toEqual([]);
  });
  it("telepathy is converted to metric", () => {
    const { system } = P.toNpcPatch({ languages: { value: ["common"], communication: { telepathy: { value: 120 } } } }, { keys, metric: { length: true } });
    expect(system.traits.languages.communication.telepathy).toEqual({ value: 36, units: "m" });
  });
});
