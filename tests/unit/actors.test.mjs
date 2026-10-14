// L2 for actor data (C11 legendary actions, C12 legendary resistance, C13 traits), EN and FR; L3 for traits.
import { describe, expect, it } from "vitest";
import { parseActor, toActorPatch } from "../../scripts/index.mjs";
import { loadActors } from "../support/load.mjs";
import { actorTokens, compare, expectedActorTokens } from "../support/canon.mjs";

const cases = loadActors();

describe.each(["en", "fr"])("L2: actor data (%s)", (lang) => {
  it.each(cases.filter(c => c.lang === lang).map(c => [c.id, c]))("%s", (_id, c) => {
    const plan = parseActor(c.actor);
    expect(plan.schema).toBe(1);
    const result = compare(expectedActorTokens(c), actorTokens(plan));
    expect({ missing: result.missing, wrong: result.wrong }).toEqual({ missing: [], wrong: [] });
  });
});

describe("L3 and patch rules for actors", () => {
  it("nothing recognized: no counters, no trait (nothing invented)", () => {
    const c = cases.find(x => x.id === "a-en-nothing");
    const plan = parseActor(c.actor);
    expect(plan.legact).toBeNull();
    expect(plan.legres).toBeNull();
    const patch = toActorPatch(plan, { actor: c.actor });
    expect(JSON.stringify(patch.system)).not.toMatch(/legact|legres/);
  });

  it("toActorPatch unions the traits with the existing ones (never removes)", () => {
    const c = cases.find(x => x.id === "a-en-lich-like");
    const actor = structuredClone(c.actor);
    actor.system.traits = { dr: { value: ["acid"], bypasses: [], custom: "" } };
    const patch = toActorPatch(parseActor(actor), { actor });
    const dr = patch.system?.traits?.dr?.value;
    expect([...(dr ?? [])].sort()).toEqual(["acid", "cold", "lightning"]);
  });

  it("toActorPatch writes the legendary counters (C11, C12)", () => {
    const c = cases.find(x => x.id === "a-en-lich-like");
    const { system } = toActorPatch(parseActor(c.actor), { actor: c.actor });
    expect(system.resources.legact.max).toBe(3);
    expect(system.resources.legres.max).toBe(3);
  });
});
