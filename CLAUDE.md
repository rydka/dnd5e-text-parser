# dnd5e Text Parser (`dnd5e-text-parser`)

Module Foundry VTT de l'atelier (voir le `CLAUDE.md` de l'atelier, deux niveaux au-dessus, pour les règles communes). Ce fichier fait foi pour ce module.

## Objectif

Bibliothèque partagée (`library: true`) qui lit le texte d'un stat block, d'une capacité ou d'un objet (anglais et français) et le traduit en données dnd5e 6. Aucune interface, aucun réglage. Consommée par `compendium-json-importer` et `item-configurator`. Spécification et conception : `specs/dnd5e-text-parser/initial/` (à la racine de l'atelier). L'API publique est documentée dans `README.md` (c'est la métrique Q1 : un autre module doit pouvoir l'intégrer sans lire le code interne ; toute modification d'API met `README.md` et `CHANGELOG.md` à jour).

## Cibles

Foundry v14, dnd5e 6.x. Sources en lecture seule : Foundry `C:/Users/Shadow/AppData/Local/Programs/Foundry Virtual Tabletop/resources/app`, dnd5e `reference/dnd5e/<version>/module/` (atelier).

## Structure

| Chemin | Contenu |
|---|---|
| `module.json` | Manifeste : `library: true`, `esmodules: ["scripts/module.mjs"]`. `version` est réécrite par le workflow de release |
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
| `scripts/dnd5e/effects.mjs` | Plan -> effets actifs v14 (`toEffects`, `effectGroupKey`) |
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
- Effets actifs au format v14 (`system.changes[].type`), jamais `changes` / `mode`. Pas d'ancien chemin `system.bonuses.*`.
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
