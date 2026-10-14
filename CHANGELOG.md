# Changelog

## 1.0.0-dev

- Objets : `parseItem` (reconnaisseurs `item-meta`, `weapon`, `armor`, `consumable`, `magic-effects`, activités d'objet), `ItemPlan` avec `details`, `effects` et `activities` (plusieurs activités par objet, soin, lancement de sort, consommation de charges, dégâts supplémentaires, effets temporaires `onUse`), `toEffects` (effets actifs v14), `toActivities` pour les activités `heal` et `cast` (`resolveSpell`), `autoDestroy` dans `toItemPatch`.
- Secours : `parseFeatureAsync`, `parseItemAsync`, `validateFallbackFacts`, `resolveMany`, délai global, `plan.fallback.status`.
- `describe` : `group`, `raw`, `origin`, `paths` sur chaque descripteur. `keysSnapshot` (clés valides sérialisables).
- Corrections : aucune attaque inventée sans en-tête (« adds 3 to its AC »), article « une créature » non compté comme cible, résistance légendaire jamais rangée en action légendaire, `raw` dans les remarques d'ambiguïté, contournements des dégâts physiques dans les unions de traits, caractéristique d'incantation innée (FR), consommation des usages une seule fois par capacité.
- Tous les textes de remarques (`Note.*`) sont traduits en et fr ; une seule table mots -> clés (`scripts/parse/lexicon/`).

- Bibliothèque : `API_VERSION` 1.0.0, `SCHEMA_VERSION` 1.
- Traduction : `toActivities`, `toItemPatch`, `toDamagePart` ; fusion `mergeMissing`, `isEmpty`, `isEmptyUtility` ; `keysFromConfig` ; `describe` ; registre `registerFallback` / `getFallback`.
- Exposition : import ES (`scripts/index.mjs`, champ `exports` de `package.json`) et `game.modules.get("dnd5e-text-parser").api` (gelée).
- Retrait du modèle : réglage `enabled`, `main.mjs`, feuille de style.
