# Control set 3 (held out)

Written by the tester, committed before any measurement. Developers must not read or tune on it.

## Content

| File | Content |
|---|---|
| `features-en.json` | 428 real creature abilities of `dnd5e.monsters` and `dnd5e.actors24` (ids `e-en-N`); displayed description as input, truth from the activity data restricted to what the text states |
| `features-fr.json`, `features-fr-source.json` | 33 hand-written French translations of selected English cases (ids `e-fr-N`), same truth |
| `objects.json` | 64 compendium items (EN, ids `g-en-N`) and 20 hand-written French items (ids `g-fr-N`), truth annotated by hand from what each name and description state |
| `build-objects.mjs` | Builder of `objects.json` (item ids, truth and French texts) |

## Method (same as the previous control sets, other salt)

- Extraction: `tests/integration/extract-control.spec.mjs` on test instance 2 (`CONTROL_EXTRACT=1`, `SALT=ctl-k7q`, `QUOTA=700`, `PICK=2`, `OBJ_QUOTA=75`).
- Abilities: removed every ability whose item id is a reference ref, whose source (pack/actor/name) is in the reference, control 1 or control 2, or whose plain text is identical to one of theirs. Then `tests/tools/build-control-features.mjs --dir=<this folder> --prefix=e`.
- Objects: excluded by uuid and by name the reference, control 1, control 2, and the `srd-items`, `heldout` and `set-b` samples of item-configurator.
- Truth audit before the commit (text against truth, no parser involved): a second result such as "or N (dice) if ..." was added to the truth when the text states it; abilities whose damage the text leaves untyped or ambiguous ignore `damage`.
- Not measured when committed.
