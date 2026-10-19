// Corrections after the item-configurator acceptance: prose uses, temporary hit points, back-reference to the previous
// property, temporary drawback, headings and flavor. The ring text is a user's item (not part of any control set).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as P from "../../scripts/index.mjs";

const keys = P.keysFromConfig(JSON.parse(readFileSync(new URL("../fixtures/dnd5e-keys.json", import.meta.url), "utf8")));
let n = 0;
const idGen = () => `q${++n}`.padEnd(16, "0");
const item = (name, html) => P.parseItem(name, html, { keys, itemType: "equipment" });
const build = (plan) => {
  const effects = P.toEffects(plan, { keys, idGen, name: plan.name ?? "Item" });
  const activities = P.toActivities(plan, { keys, idGen, item: { type: "equipment" }, effects, resolveSpell: () => null });
  return { effects, activities };
};

const RING_FR = [
  "L'Anneau du Dernier Souffle", "Peu commun", "Objet merveilleux (anneau), nécessite un lien d'harmonisation",
  "Forgé dans l'argent noirci et serti d'une pierre bleutée, cet anneau est toujours froid au toucher. Lorsque son porteur approche de la mort, la pierre émet une faible pulsation, semblable à un battement de cœur.",
  "Propriétés magiques",
  "Refus de mourir. Une fois par repos long, lorsque vous tombez à 0 point de vie sans être tué sur le coup, vous pouvez utiliser votre réaction pour tomber à 1 point de vie à la place.",
  "Souffle emprunté. Lorsque vous utilisez cette propriété, vous gagnez également un nombre de points de vie temporaires égal à 1d6 + votre bonus de maîtrise.",
  "Le prix du sursis. Jusqu'à la fin de votre prochain tour, votre vitesse est réduite de moitié et vous ne pouvez pas effectuer de réactions."
];
const RING_EN = [
  "Ring of the Last Breath", "Uncommon", "Wondrous item (ring), requires attunement",
  "Forged in blackened silver and set with a bluish stone, this ring is always cold to the touch. When its wearer nears death, the stone gives off a faint pulse, like a heartbeat.",
  "Magic Properties",
  "Refusal to Die. Once per long rest, when you drop to 0 hit points without being killed outright, you can use your reaction to drop to 1 hit point instead.",
  "Borrowed Breath. When you use this property, you also gain a number of temporary hit points equal to 1d6 + your proficiency bonus.",
  "The Price of Respite. Until the end of your next turn, your speed is halved and you can't take reactions."
];
const RINGS = [["FR", RING_FR], ["EN", RING_EN]];
const asPlain = (lines) => lines.join("\n");
const asHtml = (lines) => lines.map(l => `<p>${l}</p>`).join("");

describe("uses in prose, consumed by the activity of the right paragraph", () => {
  const cases = [
    ["EN 3 times per short or long rest", "<p>Wondrous item, rare</p><p><strong>Veil.</strong> As an action, you can cast shield at will.</p><p><strong>Mend.</strong> Three times per short or long rest, as an action, you regain 2d4 hit points.</p>", { max: 3, period: "sr" }, "Mend"],
    ["FR deux fois par jour", "<p>Objet merveilleux, rare</p><p><strong>Voile.</strong> Par une action, vous émettez une brume.</p><p><strong>Réparation.</strong> Deux fois par jour, par une action, vous récupérez 2d4 points de vie.</p>", { max: 2, period: "day" }, "Réparation"],
    ["EN once per long rest", "<p>Wondrous item, rare</p><p><strong>Glow.</strong> As an action, you shed bright light in a 10-foot radius.</p><p><strong>Spark.</strong> Once per long rest, as an action, you regain 1d8 hit points.</p>", { max: 1, period: "lr" }, "Spark"],
    ["FR une fois par repos long", "<p>Objet merveilleux, rare</p><p><strong>Lueur.</strong> Par une action, vous émettez une vive lumière.</p><p><strong>Étincelle.</strong> Une fois par repos long, par une action, vous récupérez 1d8 points de vie.</p>", { max: 1, period: "lr" }, "Étincelle"]
  ];
  for ( const [label, html, uses, owner] of cases ) {
    it(label, () => {
      const plan = item("Trinket", html);
      expect(plan.uses).toMatchObject(uses);
      const consuming = plan.activities.filter(a => a.consume);
      expect(consuming.map(a => a.name)).toEqual([owner]);
      expect(consuming[0].consume).toMatchObject({ target: "itemUses", amount: 1 });
      const patch = P.toItemPatch(plan, { keys, item: { type: "equipment" } });
      expect(patch.uses.max).toBe(String(uses.max));
      const withCost = build(plan).activities.filter(a => a.consumption?.targets?.length);
      expect(withCost.map(a => a.name)).toEqual([owner]);
      expect(withCost[0].consumption.targets[0]).toMatchObject({ type: "itemUses", value: "1" });
    });
  }
});

describe("temporary hit points", () => {
  for ( const [lang, text] of [
    ["EN", "<p>Wondrous item, rare</p><p><strong>Aegis.</strong> As an action, you gain temporary hit points equal to 1d6 + your proficiency bonus.</p>"],
    ["FR", "<p>Objet merveilleux, rare</p><p><strong>Égide.</strong> Par une action, vous gagnez un nombre de points de vie temporaires égal à 1d6 + votre bonus de maîtrise.</p>"]
  ] ) {
    it(lang, () => {
      const heal = build(item("Charm", text)).activities.find(a => a.type === "heal");
      expect(heal.healing.types).toEqual(["temphp"]);
      expect(heal.healing).toMatchObject({ number: 1, denomination: 6, bonus: "@prof" });
    });
  }

  it("a fixed amount, FR", () => {
    const heal = build(item("Charm", "<p>Objet merveilleux, rare</p><p>Par une action, vous gagnez 5 points de vie temporaires.</p>")).activities.find(a => a.type === "heal");
    expect(heal.healing.types).toEqual(["temphp"]);
  });
});

describe("the ring: back-reference, drawback, headings and flavor", () => {
  for ( const [lang, lines] of RINGS ) {
    for ( const [form, render] of [["plain text", asPlain], ["HTML paragraphs", asHtml]] ) {
      describe(`${lang}, ${form}`, () => {
        const plan = item(lines[0], render(lines));
        const { effects, activities } = build(plan);

        it("one heal activity for the first two properties", () => {
          expect(activities).toHaveLength(1);
          expect(activities[0].type).toBe("heal");
          expect(activities[0].activation.type).toBe("reaction");
          expect(activities[0].healing.types).toEqual(["temphp"]);
          expect(activities[0].healing.bonus).toBe("@prof");
          expect(activities[0].name).toMatch(/Refus de mourir|Refusal to Die/);
        });

        it("uses: once per long rest, consumed by that activity", () => {
          expect(P.toItemPatch(plan, { keys, item: { type: "equipment" } }).uses).toMatchObject({ max: "1" });
          expect(activities[0].consumption.targets[0]).toMatchObject({ type: "itemUses", value: "1" });
        });

        it("the temporary drawback is a non-transferred effect listed by the activity", () => {
          expect(effects).toHaveLength(1);
          const effect = effects[0];
          expect(effect.transfer).toBe(false);
          expect(effect.duration).toMatchObject({ value: 1, units: "turns" });
          expect(effect.system.changes).toEqual([expect.objectContaining({ key: "system.attributes.movement.multiplier", type: "multiply", value: "0.5" })]);
          expect(activities[0].effects.map(e => e._id)).toEqual([effect._id]);
        });

        it("'no reactions' and 'drop to 1 hit point instead' give NotAutomated", () => {
          const notes = plan.notes.filter(x => x.key.endsWith("Note.NotAutomated"));
          expect(notes).toHaveLength(2);
          expect(JSON.stringify(notes)).toMatch(/réaction|reactions/);
        });

        it("nothing is left in unrecognized, the lore is in flavor, describe reports Note.Flavor", () => {
          expect(plan.unrecognized).toEqual([]);
          expect(plan.flavor.length).toBeGreaterThan(0);
          expect(plan.flavor.map(f => f.text).join(" ")).toMatch(/argent noirci|blackened silver/);
          expect(P.describe(plan).some(d => d.key.endsWith("Note.Flavor"))).toBe(true);
        });

        it("rarity, kind and attunement come from the header", () => {
          expect(plan.details.rarity).toBe("uncommon");
          expect(plan.itemKind).toBe("wondrous");
          expect(plan.details.attunement).toBe("required");
        });
      });
    }
  }
});

describe("a back-reference does not create a second activity", () => {
  it("EN 'Whenever you do so'", () => {
    const plan = item("Band", "<p>Wondrous item, rare</p><p><strong>Surge.</strong> Once per long rest, as an action, you regain 1d8 hit points.</p><p><strong>Echo.</strong> Whenever you do so, you also gain 5 temporary hit points.</p>");
    expect(build(plan).activities.filter(a => a.type === "heal")).toHaveLength(1);
  });
  it("FR 'Ce faisant'", () => {
    const plan = item("Bande", "<p>Objet merveilleux, rare</p><p><strong>Sursaut.</strong> Une fois par repos long, par une action, vous récupérez 1d8 points de vie.</p><p><strong>Écho.</strong> Ce faisant, vous gagnez également 5 points de vie temporaires.</p>");
    expect(build(plan).activities.filter(a => a.type === "heal")).toHaveLength(1);
  });
});
