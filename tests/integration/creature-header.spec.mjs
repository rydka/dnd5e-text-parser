// L2 in a real Foundry: toNpcPatch(...).system builds valid dnd5e 6 NPCs (EN and FR, imperial and metric worlds).
import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const EN = `Armor Class 16 (natural armor)
Hit Points 136 (16d8 + 64)
Speed 30 ft., fly 60 ft. (hover), swim 20 ft.
STR DEX CON INT WIS CHA
18 (+4) 12 (+1) 18 (+4) 10 (+0) 14 (+2) 12 (+1)
Saving Throws Str +7, Wis +5
Skills Athletics +7, Perception +5
Senses darkvision 60 ft., passive Perception 15
Languages Common, Abyssal, telepathy 120 ft.
Challenge 5 (1,800 XP) Proficiency Bonus +3`;

const FR = `Classe d'armure 16 (armure naturelle)
Points de vie 136 (16d8 + 64)
Vitesse 9 m, vol 18 m (vol stationnaire), nage 6 m
FOR DEX CON INT SAG CHA
18 (+4) 12 (+1) 18 (+4) 10 (+0) 14 (+2) 12 (+1)
Jets de sauvegarde For +7, Sag +5
Compétences Athlétisme +7, Perception +5
Sens vision dans le noir 18 m, Perception passive 15
Langues commun, abyssal
Facteur de puissance 5 (1 800 PX)`;

for ( const [lang, text] of [["EN", EN], ["FR", FR]] ) {
  for ( const metric of [false, true] ) {
    test(`L2: ${lang} stat block builds a valid NPC in a ${metric ? "metric" : "imperial"} world`, async ({ foundry, gamePage }, testInfo) => {
      const logs = [];
      gamePage.on("console", msg => ["error", "warning"].includes(msg.type()) && logs.push(`${msg.type()}: ${msg.text()}`));
      gamePage.on("pageerror", err => logs.push(`pageerror: ${err.message}`));
      const out = await foundry(async ({ text, metric, moduleId }) => {
        const P = await import(`/modules/${moduleId}/scripts/index.mjs`);
        const keys = P.keysFromConfig(CONFIG.DND5E);
        const previous = game.settings.get("dnd5e", "metricLengthUnits");
        await game.settings.set("dnd5e", "metricLengthUnits", metric);
        let actor;
        try {
          const world = game.settings.get("dnd5e", "metricLengthUnits");
          const stats = P.parseStatLines(text);
          const { system, notes } = P.toNpcPatch(stats, { keys, metric: world });
          const cls = CONFIG.Actor.documentClass;
          // dry run: strict validation of the data, nothing persisted
          let dryRun = "ok";
          try { new cls({ name: "L2 dry run", type: "npc", system }).validate({ strict: true }); }
          catch (e) { dryRun = String(e.message ?? e); }
          actor = await cls.create({ name: "L2 header actor", type: "npc", system });
          const s = actor.system;
          return {
            world, dryRun, notes, patch: system,
            ac: s.attributes.ac.value, hpMax: s.attributes.hp.max, hpValue: s.attributes.hp.value,
            movement: { ...s.attributes.movement }, senses: { ...s.attributes.senses.ranges },
            strMod: s.abilities.str.mod, dexMod: s.abilities.dex.mod, strSave: s.abilities.str.save.value,
            athletics: s.skills.ath.total, athProf: s.skills.ath.value, perception: s.skills.prc.total,
            cr: s.details.cr, prof: s.attributes.prof, languages: [...s.traits.languages.value],
            telepathy: s.traits.languages.communication?.telepathy ?? null
          };
        } finally {
          await actor?.delete();
          await game.settings.set("dnd5e", "metricLengthUnits", previous);
        }
      }, { text, metric, moduleId: "dnd5e-text-parser" });
      fs.writeFileSync(testInfo.outputPath(`L2-${lang}-${metric ? "metric" : "imperial"}.json`), JSON.stringify({ ...out, logs }, null, 1));
      expect(out.world).toBe(metric);
      expect(out.dryRun).toBe("ok");
      expect(out.ac).toBe(16);
      expect(out.hpMax).toBe(136);
      expect(out.hpValue).toBe(136);
      expect(out.movement.units).toBe(metric ? "m" : "ft");
      expect(out.movement.walk).toBe(metric ? 9 : 30);
      expect(out.movement.fly).toBe(metric ? 18 : 60);
      expect(out.movement.swim).toBe(metric ? 6 : 20);
      expect(out.movement.hover).toBe(true);
      expect(out.senses.darkvision).toBe(metric ? 18 : 60);
      expect(out.strMod).toBe(4);
      expect(out.dexMod).toBe(1);
      expect(out.cr).toBe(5);
      expect(out.prof).toBe(3);
      expect(out.strSave).toBe(7);
      expect(out.athletics).toBe(7);
      expect(out.perception).toBe(5);
      expect(out.languages).toEqual(expect.arrayContaining(["common", "abyssal"]));
      expect(logs).toEqual([]);
    });
  }
}
