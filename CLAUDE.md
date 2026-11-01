# dnd5e Text Parser (`dnd5e-text-parser`)

Module Foundry VTT de l'atelier (voir le `CLAUDE.md` de l'atelier, deux niveaux au-dessus, pour les règles communes). Ce fichier fait foi pour ce module.

## Objectif

Bibliothèque partagée (`library: true`) qui lit le texte d'un stat block, d'une capacité ou d'un objet (anglais et français) et le traduit en données dnd5e 5.3.3. Aucune interface, aucun réglage. Consommée par `compendium-json-importer` et `item-configurator`. Spécification et conception : `specs/dnd5e-text-parser/initial/` (à la racine de l'atelier). L'API publique est documentée dans `README.md` (c'est la métrique Q1 : un autre module doit pouvoir l'intégrer sans lire le code interne ; toute modification d'API met `README.md` et `CHANGELOG.md` à jour).

## Cibles

**Branche `v13`** : Foundry **v13** (≥ 13.347), dnd5e **5.3.x** (sources : `reference/dnd5e/5.3.3/module/` à la racine de l'atelier). Version `1.1.0-v13`, manifeste `https://raw.githubusercontent.com/rydka/dnd5e-text-parser/v13/module.json`, release publiée avec `--latest=false` (la version v14 / dnd5e 6 vit sur `main` et suit `releases/latest`). Foundry v13 n'est pas installé dans l'atelier : API v13 par la documentation https://foundryvtt.com/api/v13/. Spécification et conception du portage : `specs/item-configurator/v13/`.

Les fonctionnalités de cette ligne passent par `agentic-dev/dnd5e-text-parser/v13-port` (ou une branche issue de `v13`), fusionnées dans `v13`, jamais dans `main`. `tests/integration/` vise la v14 : non exécuté sur cette branche (tests unitaires seulement).

### Écarts avec la v14 (`main`)

| # | Fichier | v14 / dnd5e 6 (`main`) | v13 / dnd5e 5.3.3 (cette branche) |
|---|---|---|---|
| P1 | `scripts/dnd5e/effects.mjs` | `system.changes[{ key, type, value, phase }]` | `changes[{ key, mode, value: String, priority: null }]` au premier niveau ; `mode` numérique via `CHANGE_MODES` (export) |
| P2 | `effects.mjs` | `system.rolls.attack.*`, `rolls.damage.*`, `skills.<s>.roll.bonus`, `abilities.<a>.<kind>.roll.bonus`, `rolls.ability.<kind>.bonus` | `system.bonuses.<mwak\|rwak\|msak\|rsak>.attack` / `.damage` (les quatre sans portée), `skills.<s>.bonuses.check`, `abilities.<a>.bonuses.<kind>`, `bonuses.abilities.<kind>` (`data/actor/templates/creature.mjs`, `common.mjs`) |
| P3 | `effects.mjs` | avantage général : `system.rolls.ability.<roll>.mode` | un changement `abilities.<a>.<check\|save>.roll.mode` par caractéristique de `keys.abilities` (défaut `str dex con int wis cha`) |
| P4 | `effects.mjs` | `movement.speeds.<type>` | `movement.<type>` pour `walk burrow climb fly swim` seulement (`data/shared/movement-field.mjs`) ; `jump` → `Note.EffectSkipped` |
| P5 | `effects.mjs` | `movement.multiplier` (`multiply`) | un changement `multiply` par champ de vitesse présent dans `keys.movementTypes` |
| P6 | `effects.mjs` | `duration = { value, units }` | `toEffectDuration` (export) → `{ seconds }` / `{ rounds }` / `{ turns }` ; « jusqu'à la fin / au début du prochain tour » → `{ turns: 1 }` (pas d'expiration par évènement en v13 : peut expirer un peu plus tôt ou plus tard) |
| P7 | `scripts/dnd5e/item.mjs`, `describe.mjs` | `system.rarities = [r]` | `system.rarity = r` (`data/item/templates/physical-item.mjs`) |
| P8 | `scripts/dnd5e/npc.mjs` | `movement = { speeds, units, hover }` | `movement = { walk, fly…, units, hover }` (`jump` écarté, `Note.NpcKeyInvalid`) |
| P9 | `npc.mjs` | `ac = { calcs: ["natural"], flat }` | `ac = { calc: "natural", flat }` (`data/actor/templates/attributes.mjs`) |
| P10 | `module.json`, `scripts/index.mjs`, `.github/workflows/release.yml` | `1.1.0`, compatibilité 14, dnd5e ≥ 6.0.0, manifeste `releases/latest` | `1.1.0-v13`, compatibilité 13, dnd5e 5.3.0 – 5.99, manifeste raw de la branche `v13`, `download` = zip de la release du tag |

Identiques : `senses.ranges.<clé>`, `traits.dr/dv/di/ci.value`, `traits.dm.amount.*` / `dm.bypasses`, `abilities.<a>.value`, `attributes.ac.bonus`, toutes les activités (`activities.mjs`), `keys.mjs` (5.3.3 n'a ni `areaTargetTypes.ring` ni `activityTypes.teleport`), tout `scripts/parse/**`. À constater dans un Foundry v13 : `cast.spell.challenge.save` est un `NumberField` en 5.3.3 (`activities.mjs` écrit `String(dc)`).

## Structure

| Chemin | Contenu |
|---|---|
| `module.json` | Manifeste : `library: true`, `esmodules: ["scripts/module.mjs"]`. `version` et `download` sont committés dans la branche (le manifeste raw est lu tel quel) ; le workflow ne réécrit que la copie jointe à la release |
| `package.json` | `exports: { ".": "./scripts/index.mjs" }` (import `file:../dnd5e-text-parser` depuis d'autres dépôts), `npm run coverage` |
| `scripts/index.mjs` | API publique pure, **sans effet de bord** : réexports, `API_VERSION`, `SCHEMA_VERSION` |
| `scripts/module.mjs` | Seul fichier qui touche Foundry : `game.modules.get(id).api` (gelée) au `init`, puis hook `dnd5e-text-parser.ready` |
| `scripts/registry.mjs` | Registre du résolveur de secours (`registerFallback`, `getFallback`) |
| `scripts/parse/**` | Analyse texte -> plan (pure) |
| `scripts/parse/stat-lines.mjs` | En-tête d'un bloc de stats : `parseStatLines` (ligne de taille, stats, traits, `raw`, `unrecognized`) et analyseurs par champ (`parseSizeLine`, `parseAc`, `parseHp`, `parseSpeed`, `parseAbilities`, `parseChallenge`, `parseSenses`, `parseLanguages`, `parseSaves`, `parseSkills`). Porté de `compendium-json-importer` (`scripts/core/pdf/stat-lines.mjs`) ; écarts listés dans `CHANGELOG.md` 1.1.0 |
| `scripts/parse/lexicon/stat-block.mjs` | Lexique de l'en-tête (`STAT_LEXICON` : libellés, tailles, types, caractéristiques, vitesses, sens, compétences, langues, unités ; clé dnd5e -> mots EN/FR) et ses aides (`labelOf`, `statLookup`, `alternation`) ; distinct des tables mot -> clé de `lexicon/index.mjs` |
| `scripts/dnd5e/npc.mjs` | `StatLines` -> patch `system` d'acteur `npc` (`toNpcPatch`, option `metric` = unités du monde) ; réutilise `traitPatch` de `actor.mjs` |
| `scripts/dnd5e/activities.mjs` | Plan -> activités (`toActivities`, `toDamagePart`) |
| `scripts/dnd5e/item.mjs` | Plan -> patch `system` d'objet (`toItemPatch`) |
| `scripts/dnd5e/merge.mjs` | Fusion « champs vides seulement » (`isEmpty`, `isEmptyUtility`, `mergeMissing`) |
| `scripts/dnd5e/keys.mjs` | `keysFromConfig(CONFIG.DND5E)`, `keysSnapshot` (instantané JSON), `isValidKey` |
| `scripts/dnd5e/effects.mjs` | Plan -> effets actifs v13 (`toEffects`, `effectGroupKey`, `toEffectDuration`, `CHANGE_MODES`) |
| `scripts/dnd5e/describe.mjs` | `describe` -> descripteurs `{ key, data, group, raw, origin, paths }`, `DESCRIBE_KEYS` |
| `scripts/parse/item-plan.mjs` | `parseItem` : détails, effets, activités d'objet |
| `scripts/parse/fallback.mjs` | `parseFeatureAsync`, `parseItemAsync`, `validateFallbackFacts` (seul fichier qui utilise `AbortController` et les minuteries, déclarés dans `eslint.config.mjs`) |
| `scripts/parse/recognizers/` | `attack`, `range-target`, `damage`, `save-area`, `uses`, `activation`, `legendary`, `traits`, `item-meta`, `weapon`, `armor`, `consumable`, `magic-effects`, `feature-effects` (effets d'une capacité passive de créature : réduction de dégâts, sens, hausse de CA, remarque `Note.NotAutomated`), `item-activity` (heal, soin et PV temporaires, cast, consume, durée, segmentation, paragraphe qui renvoie à la propriété précédente), `headings` (intitulés d'un objet en texte brut : nom, titres de section, noms de propriété ; texte d'ambiance `isFlavorLine`) |
| `lang/` | Traductions `en` et `fr`, clés sous `dnd5e-text-parser.*` (`Describe.*`, `Note.*`) |
| `tests/unit/` | Tests Vitest ; `tests/integration/` : tests dans un vrai Foundry |

## Conventions

- Tout ce que le module ajoute est préfixé par `dnd5e-text-parser` : clés de traduction, hook `dnd5e-text-parser.ready`.
- **Pureté** : `scripts/parse/**`, `scripts/dnd5e/**`, `scripts/index.mjs`, `scripts/registry.mjs` n'utilisent aucune globale Foundry ni navigateur (ESLint `globals: {}`). Tout ce qui vient de Foundry (`CONFIG.DND5E`, générateur d'identifiants) est passé en paramètre.
- Aucune clé dnd5e inventée : les valeurs absentes de `keys` sont écartées (jamais écrites), un mot inconnu donne une remarque.
- Effets actifs au format v13 (`changes[]` au premier niveau, `mode` numérique de `CHANGE_MODES`, `value` chaîne), jamais `system.changes[].type`. Chemins d'acteur de dnd5e 5.3.3 (`system.bonuses.*`, `abilities.<a>.bonuses.*`), jamais `system.rolls.*`.
- Compatibilité : aucune rupture d'API sans changement de majeure (`API_VERSION` = version du module). Champs de plan ajoutés = optionnels.

## Commandes

```
npm install
npm test
npm run coverage   # seuil 90 % sur scripts/parse/** et scripts/dnd5e/**
npm run lint
```

## Points de contact avec d'autres modules

- Expose `game.modules.get("dnd5e-text-parser").api` (posée au `init`, gelée) et le hook personnalisé `dnd5e-text-parser.ready` (argument : l'API). Les modules consommateurs le déclarent dans `relationships.requires`.
- Aucun hook de Foundry ou de dnd5e écouté en dehors de `init`, aucune méthode remplacée, aucun sélecteur CSS global, aucun module tiers détecté.
