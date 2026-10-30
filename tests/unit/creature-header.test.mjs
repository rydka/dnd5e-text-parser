// creature-header: L1 (pure field parsers, EN and FR, raw/unrecognized), L2 (toNpcPatch, dnd5e 6 format),
// L3 (metric units, toPounds decimals), L4 (cases ported from the importer's stat-line parsers), L5 (API version).
// The importer has no dedicated unit test for these functions (it checks them through synthetic PDFs), so the cases
// below are written from its parsers' documented examples. Assumptions to confirm with the developer are marked (A).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "../../scripts/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snapshot = JSON.parse(fs.readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8"));
// The snapshot has no `senses`: add them (as in CONFIG.DND5E.senses) for the sense tests.
const keys = P.keysFromConfig({ ...snapshot, senses: { darkvision: "", blindsight: "", tremorsense: "", truesight: "" } });

const EN_BLOCK = `Armor Class 16 (natural armor)
Hit Points 136 (16d8 + 64)
Speed 30 ft., fly 60 ft. (hover), swim 20 ft.
STR DEX CON INT WIS CHA
18 (+4) 12 (+1) 18 (+4) 10 (+0) 14 (+2) 12 (+1)
Saving Throws Str +7, Wis +5
Skills Athletics +7, Perception +5
Senses darkvision 60 ft., passive Perception 15
Languages Common, Abyssal, telepathy 120 ft.
Challenge 5 (1,800 XP) Proficiency Bonus +3`;

const FR_BLOCK = `Classe d'armure 15 (armure naturelle)
Points de vie 52 (8d8 + 16)
Vitesse 9 m, vol 18 m (vol stationnaire)
FOR DEX CON INT SAG CHA
16 (+3) 14 (+2) 14 (+2) 8 (-1) 12 (+1) 10 (+0)
Jets de sauvegarde For +5, Sag +3
Compétences Athlétisme +5, Perception +3
Sens vision dans le noir 18 m, Perception passive 13
Langues commun, abyssal
Facteur de puissance 3 (700 PX)`;

describe("L5: version and API surface", () => {
  it("API_VERSION is 1.1.0 and matches module.json", () => {
    expect(P.API_VERSION).toBe("1.1.0");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    expect(manifest.version.split("-")[0]).toBe("1.1.0");
  });

  it.each([
    "parseStatLines", "parseSizeLine", "parseAc", "parseHp", "parseSpeed", "parseAbilities", "parseChallenge",
    "parseSenses", "parseLanguages", "parseSaves", "parseSkills", "toNpcPatch"
  ])("exports %s", (name) => expect(typeof P[name]).toBe("function"));

  it.each([
    "parseFeature", "parseItem", "parseActor", "parseSpellcasting", "nameKey", "htmlToText", "splitSentences",
    "splitLines", "toFeet", "toPounds", "toActivities", "toDamagePart", "toEffects", "toItemPatch", "toActorPatch",
    "toSpellStubs", "isEmpty", "isEmptyUtility", "mergeMissing", "keysFromConfig", "keysSnapshot", "describe",
    "registerFallback", "getFallback", "parseFeatureAsync", "parseItemAsync", "validateFallbackFacts"
  ])("non-regression: %s is still exported", (name) => expect(typeof P[name]).toBe("function"));

  it("non-regression: existing results unchanged", () => {
    expect(P.SCHEMA_VERSION).toBe(1);
    expect(P.toFeet(9, "m")).toBe(30);
    expect(P.toFeet("30", "ft")).toBe(30);
    expect(P.toPounds(10, "lb")).toBe(10);
    expect(P.toPounds(1, "kg")).toBe(2);
    expect(P.parseFeature("Bite", "<p>+5 to hit, reach 5 ft., one target.</p>").schema).toBe(1);
  });
});

describe("L1: parseSizeLine", () => {
  it("Medium undead/fiend (wraith), neutral evil", () => {
    const r = P.parseSizeLine("Medium undead/fiend (wraith), neutral evil");
    expect(r).toMatchObject({ size: "med", type: "undead", subtype: "fiend, wraith", alignment: "neutral evil" });
    expect(r.types).toEqual(["undead", "fiend"]);
  });
  it("Medium Undead, Neutral Evil", () => {
    expect(P.parseSizeLine("Medium Undead, Neutral Evil")).toMatchObject({ size: "med", type: "undead", alignment: "Neutral Evil" });
  });
  it("swarm", () => {
    expect(P.parseSizeLine("Medium swarm of Tiny beasts, unaligned")).toMatchObject({ size: "med", type: "beast", swarm: "tiny", alignment: "unaligned" });
  });
  it("French: Mort-vivant (fantôme) de taille M, tout alignement", () => {
    const r = P.parseSizeLine("Mort-vivant (fantôme) de taille M, tout alignement");
    expect(r).toMatchObject({ size: "med", type: "undead", subtype: "fantôme", alignment: "tout alignement", anyAlignment: true });
  });
  it("French swarm", () => {
    expect(P.parseSizeLine("Nuée de taille M de bêtes de taille TP, non aligné")).toMatchObject({ size: "med", type: "beast", swarm: "tiny" });
  });
  it("French: humanoïde de taille M ou P", () => {
    expect(P.parseSizeLine("Humanoïde de taille M ou P, neutre")).toMatchObject({ size: "med", type: "humanoid" });
  });
  it("not a size line: null, nothing invented", () => {
    expect(P.parseSizeLine("")).toBeNull();
    expect(P.parseSizeLine("Armor Class 16")).toBeNull();
    expect(P.parseSizeLine("Medium something, evil")).toBeNull();
  });
});

describe("L1: field parsers", () => {
  it("parseAc", () => {
    expect(P.parseAc("16 (natural armor)")).toMatchObject({ value: 16, detail: "natural armor", natural: true });
    expect(P.parseAc("17 (chain mail, shield)")).toMatchObject({ value: 17, natural: false });
    expect(P.parseAc("15")).toMatchObject({ value: 15, detail: "", natural: false });
    expect(P.parseAc("15 (armure naturelle)").natural).toBe(true);
    expect(P.parseAc("none")).toBeNull();
  });
  it("parseHp", () => {
    expect(P.parseHp("136 (16d8 + 64)")).toMatchObject({ value: 136, formula: "16d8 + 64" });
    expect(P.parseHp("7")).toMatchObject({ value: 7, formula: "" });
    expect(P.parseHp("")).toBeNull();
  });
  it("parseSpeed (feet, metres, hover)", () => {
    expect(P.parseSpeed("30 ft., fly 60 ft. (hover), swim 20 ft.")).toMatchObject({ speeds: { walk: 30, fly: 60, swim: 20 }, hover: true });
    expect(P.parseSpeed("9 m, vol 18 m (vol stationnaire)")).toMatchObject({ speeds: { walk: 30, fly: 60 }, hover: true });
    expect(P.parseSpeed("0 ft.")).toMatchObject({ speeds: { walk: 0 }, hover: false });
    expect(P.parseSpeed("")).toBeNull();
  });
  it("parseAbilities (2014 row and 2024 cells)", () => {
    const old = P.parseAbilities([{ text: "STR DEX CON INT WIS CHA" }, { text: "18 (+4) 12 (+1) 18 (+4) 10 (+0) 14 (+2) 12 (+1)" }]);
    expect(old.scores).toEqual({ str: 18, dex: 12, con: 18, int: 10, wis: 14, cha: 12 });
    const cells = P.parseAbilities([{ text: "Str 16 +3 +3 Dex 10 +0 +0 Con 14 +2 +5 Int 8 -1 -1 Wis 12 +1 +1 Cha 10 +0 +0" }]);
    expect(cells.scores.str).toBe(16);
    expect(cells.saves).toEqual({ con: 5 });
    expect(P.parseAbilities([{ text: "nothing here" }])).toBeNull();
  });
  it("parseChallenge", () => {
    expect(P.parseChallenge("12 (8,400 XP) Proficiency Bonus +4")).toMatchObject({ cr: 12, xp: 8400, prof: 4 });
    expect(P.parseChallenge("5 (XP 1,800; PB +3)")).toMatchObject({ cr: 5, xp: 1800, prof: 3 });
    expect(P.parseChallenge("1/2 (100 XP)")).toMatchObject({ cr: 0.5, xp: 100 });
    expect(P.parseChallenge("½")).toMatchObject({ cr: 0.5 });
    expect(P.parseChallenge("3 (700 PX)")).toMatchObject({ cr: 3, xp: 700 });
    expect(P.parseChallenge("")).toBeNull();
  });
  it("parseSenses", () => {
    const r = P.parseSenses("darkvision 120 ft., blindsight 30 ft., passive Perception 13");
    expect(r.ranges).toEqual({ darkvision: 120, blindsight: 30 });
    expect(P.parseSenses("vision dans le noir 18 m").ranges).toEqual({ darkvision: 60 });
    expect(P.parseSenses("")).toBeNull();
  });
  it("parseLanguages", () => {
    const r = P.parseLanguages("Common, Abyssal, telepathy 60 ft.");
    expect(r.value).toEqual(["abyssal", "common"]);
    expect(r.communication.telepathy).toMatchObject({ value: 60 });
    expect(P.parseLanguages("commun, abyssal").value).toEqual(["abyssal", "common"]);
    expect(P.parseLanguages("—")).toBeNull();
  });
  it("parseSaves", () => {
    expect(P.parseSaves("Str +11, Wis +9")).toEqual({ str: 11, wis: 9 });
    expect(P.parseSaves("For +11, Sag +9")).toEqual({ str: 11, wis: 9 });
    expect(P.parseSaves("nothing")).toBeNull();
  });
  it("parseSkills (proficiency and expertise)", () => {
    expect(P.parseSkills("Athletics +11, Perception +4")).toEqual({ ath: 1, prc: 1 });
    expect(P.parseSkills("Perception +9", { scores: { wis: 14 }, prof: 3 })).toEqual({ prc: 2 });
    expect(P.parseSkills("Perception +5", { scores: { wis: 14 }, prof: 3 })).toEqual({ prc: 1 });
    expect(P.parseSkills("Compétences inconnues +3")).toBeNull();
  });
  it("field parsers are pure: same input, same output", () => {
    expect(P.parseHp("10 (2d8 + 1)")).toEqual(P.parseHp("10 (2d8 + 1)"));
  });
});

describe("L1/L4: parseStatLines", () => {
  it("English block", () => {
    const s = P.parseStatLines(EN_BLOCK);
    expect(s.ac).toMatchObject({ value: 16, natural: true });
    expect(s.hp).toMatchObject({ value: 136, formula: "16d8 + 64" });
    expect(s.speed.speeds).toEqual({ walk: 30, fly: 60, swim: 20 });
    expect(s.abilities).toEqual({ str: 18, dex: 12, con: 18, int: 10, wis: 14, cha: 12 });
    expect(s.saves).toEqual({ str: 7, wis: 5 });
    expect(s.skills).toMatchObject({ ath: 1, prc: 1 });
    expect(s.senses.ranges).toEqual({ darkvision: 60 });
    expect(s.languages.value).toEqual(["abyssal", "common"]);
    expect(s.cr).toBe(5);
    expect(s.xp).toBe(1800);
    expect(s.prof).toBe(3);
  });
  it("French block", () => {
    const s = P.parseStatLines(FR_BLOCK);
    expect(s.ac).toMatchObject({ value: 15, natural: true });
    expect(s.hp.value).toBe(52);
    expect(s.speed).toMatchObject({ speeds: { walk: 30, fly: 60 }, hover: true });
    expect(s.abilities.wis).toBe(12);
    expect(s.saves).toEqual({ str: 5, wis: 3 });
    expect(s.senses.ranges).toEqual({ darkvision: 60 });
    expect(s.languages.value).toEqual(["abyssal", "common"]);
    expect(s.cr).toBe(3);
    expect(s.xp).toBe(700);
  });
  it("2024 layout: AC and Initiative on one line, ability cells", () => {
    const s = P.parseStatLines(`AC 17 Initiative +2 (12)
HP 58 (9d8 + 18)
Speed 30 ft.
Str 16 +3 +3 Dex 14 +2 +2 Con 14 +2 +2 Int 8 -1 -1 Wis 12 +1 +1 Cha 10 +0 +0
CR 5 (XP 1,800; PB +3)`);
    expect(s.ac.value).toBe(17);
    expect(s.initiative.bonus).toBe(2);
    expect(s.abilities.str).toBe(16);
    expect(s).toMatchObject({ cr: 5, xp: 1800, prof: 3 });
  });
  it("wrapped values continue the previous line", () => {
    const s = P.parseStatLines("Languages Common,\nAbyssal\nArmor Class 12");
    expect(s.languages.value).toEqual(["abyssal", "common"]);
    expect(s.ac.value).toBe(12);
  });
  it("missing lines give null, never invented values", () => {
    const s = P.parseStatLines("Armor Class 12");
    expect(s.hp).toBeNull();
    expect(s.speed).toBeNull();
    expect(s.abilities).toBeNull();
    expect(s.cr).toBeNull();
  });
  it("(L1) keeps the original passage in raw", () => {
    const s = P.parseStatLines(EN_BLOCK);
    expect(s.ac.raw).toContain("16 (natural armor)");
    expect(s.hp.raw).toContain("136 (16d8 + 64)");
    expect(s.speed.raw).toContain("fly 60 ft.");
    expect(s.senses.raw).toContain("darkvision 60 ft.");
  });
  it("(L1) lines not recognized go to unrecognized", () => {
    const s = P.parseStatLines("Armor Class 12\nHit Points 5 (1d8)\nBlorp zorp frobnicate");
    expect(Array.isArray(s.unrecognized)).toBe(true);
    expect(JSON.stringify(s.unrecognized)).toContain("Blorp zorp frobnicate");
    expect(s.ac.value).toBe(12);
  });
  it("(L1) an unreadable value is not invented", () => {
    const s = P.parseStatLines("Armor Class many\nHit Points lots");
    expect(s.ac ?? null).toBeNull();
    expect(s.hp ?? null).toBeNull();
    expect(JSON.stringify(s.unrecognized)).toMatch(/many/);
  });
  it("(A) accepts an array of lines as the importer does", () => {
    expect(P.parseStatLines(EN_BLOCK.split("\n")).hp.value).toBe(136);
  });
});

describe("L2: toNpcPatch", () => {
  const stats = P.parseStatLines(EN_BLOCK);
  const sysOf = (s, opts) => { const p = P.toNpcPatch(s, { keys, ...opts }); return p.system ?? p; };

  it("AC in dnd5e 6 format: natural -> calcs + flat, never calc/formula", () => {
    const system = sysOf(stats);
    expect(system.attributes.ac).toEqual({ calcs: ["natural"], flat: 16 });
  });
  it("AC with a cited armor and no object -> calcs natural + flat", () => {
    expect(sysOf(P.parseStatLines("Armor Class 17 (chain mail, shield)")).attributes.ac).toEqual({ calcs: ["natural"], flat: 17 });
  });
  it("AC without detail -> calcs natural + flat", () => {
    const ac = sysOf(P.parseStatLines("Armor Class 15")).attributes.ac;
    expect(ac).toEqual({ calcs: ["natural"], flat: 15 });
    expect(ac).not.toHaveProperty("calc");
    expect(ac).not.toHaveProperty("formula");
  });
  it("hp: value, max, formula", () => {
    expect(sysOf(stats).attributes.hp).toEqual({ value: 136, max: 136, formula: "16d8 + 64" });
  });
  it("speeds in movement.speeds.<type> + units", () => {
    const m = sysOf(stats).attributes.movement;
    expect(Number(m.speeds.walk)).toBe(30);
    expect(Number(m.speeds.fly)).toBe(60);
    expect(Number(m.speeds.swim)).toBe(20);
    expect(m.units).toBe("ft");
    expect(m).not.toHaveProperty("walk");
  });
  it("abilities, proficient saves, proficient skills", () => {
    const system = sysOf(stats);
    expect(system.abilities.str.value).toBe(18);
    expect(system.abilities.str.proficient).toBe(1);
    expect(system.abilities.wis.proficient).toBe(1);
    expect(system.abilities.dex.proficient ?? 0).toBe(0);
    expect(system.skills.ath.value).toBe(1);
    expect(system.skills.prc.value).toBe(1);
  });
  it("senses, languages, CR", () => {
    const system = sysOf(stats);
    expect(system.attributes.senses.ranges.darkvision).toBe(60);
    expect(system.traits.languages.value).toEqual(expect.arrayContaining(["common", "abyssal"]));
    expect(system.details.cr).toBe(5);
  });
  it("(A) size, type, alignment from parseSizeLine passed as stats.size", () => {
    const sys = sysOf({ ...stats, size: P.parseSizeLine("Large dragon, lawful evil") });
    expect(sys.traits.size).toBe("lg");
    expect(sys.details.type.value).toBe("dragon");
    expect(sys.details.alignment).toBe("lawful evil");
  });
  it("only keys present in `keys` are written", () => {
    const narrow = { ...keys, movementTypes: new Set(["walk"]), skills: new Set(["ath"]) };
    const sys = P.toNpcPatch(stats, { keys: narrow });
    const system = sys.system ?? sys;
    expect(system.attributes.movement.speeds.fly).toBeUndefined();
    expect(system.attributes.movement.speeds.swim).toBeUndefined();
    expect(system.attributes.movement.speeds.walk).toBeDefined();
    expect(system.skills.prc).toBeUndefined();
    expect(system.skills.ath).toBeDefined();
  });
  it("an ability key absent from keys is dropped", () => {
    const narrow = { ...keys, abilities: new Set(["str"]) };
    const p = P.toNpcPatch(stats, { keys: narrow });
    const system = p.system ?? p;
    expect(system.abilities.dex).toBeUndefined();
    expect(system.abilities.str.value).toBe(18);
  });
  it("empty stats: nothing invented", () => {
    const system = sysOf(P.parseStatLines(""));
    expect(system.attributes?.ac).toBeUndefined();
    expect(system.attributes?.hp).toBeUndefined();
    expect(system.details?.cr).toBeUndefined();
  });
  it("does not mutate its input", () => {
    const copy = structuredClone(stats);
    P.toNpcPatch(stats, { keys });
    expect(stats).toEqual(copy);
  });
});

describe("L3: metric units", () => {
  const stats = P.parseStatLines("Speed 30 ft., fly 60 ft.\nSenses darkvision 60 ft.");
  // (A) option shape: metric: { length: true, weight: true }
  const metric = { length: true, weight: true };
  const sysOf = (s, opts) => { const p = P.toNpcPatch(s, { keys, ...opts }); return p.system ?? p; };

  it("distances converted with 1.5 m = 5 ft, no rounding to integers", () => {
    const sys = sysOf(stats, { metric });
    expect(sys.attributes.movement.units).toBe("m");
    expect(Number(sys.attributes.movement.speeds.walk)).toBeCloseTo(9, 5);
    expect(Number(sys.attributes.movement.speeds.fly)).toBeCloseTo(18, 5);
    expect(sys.attributes.senses.units).toBe("m");
    expect(sys.attributes.senses.ranges.darkvision).toBeCloseTo(18, 5);
  });
  it("5 ft = 1.5 m is not rounded", () => {
    const sys = sysOf(P.parseStatLines("Speed 5 ft."), { metric });
    expect(Number(sys.attributes.movement.speeds.walk)).toBeCloseTo(1.5, 5);
  });
  it("without metric: feet", () => {
    const sys = sysOf(stats);
    expect(sys.attributes.movement.units).toBe("ft");
    expect(Number(sys.attributes.movement.speeds.walk)).toBe(30);
  });
  it("toPounds keeps decimals: 0.2 kg = 0.4 lb", () => {
    expect(P.toPounds(0.2, "kg")).toBeCloseTo(0.4, 5);
    expect(P.toPounds("0,2", "kg")).toBeCloseTo(0.4, 5);
    expect(P.toPounds(1, "kg")).toBe(2);
    expect(P.toPounds(1.5, "kg")).toBe(3);
    expect(P.toPounds(10, "lb")).toBe(10);
    expect(P.toPounds("abc", "kg")).toBeNull();
  });
});
