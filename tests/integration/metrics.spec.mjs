// Measures M2, M3, M5 on the reference set (adjustment) and the control set (generalization) and stores them as
// named evidence. Never fails on the values: a metric is measured and recorded, it is not an assertion.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "../..");

test("M2/M3: recall and precision on the reference and control sets (recorded, not asserted)", async ({}, testInfo) => {
  for ( const set of ["reference", "control"] ) {
    const out = testInfo.outputPath(`M2-M3-${set}.json`);
    const run = spawnSync(process.execPath, [path.join(root, "tests/metrics/measure-sets.mjs"), `--set=${set}`, `--out=${out}`], { cwd: root, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    fs.writeFileSync(testInfo.outputPath(`M2-M3-${set}.txt`), run.stdout);
  }
});

test("M5: time of a full stat block without fallback (recorded, not asserted)", async ({}, testInfo) => {
  const out = testInfo.outputPath("M5-timing.json");
  const run = spawnSync(process.execPath, [path.join(root, "tests/metrics/measure.mjs"), `--out=${out}`], { cwd: root, encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  fs.writeFileSync(testInfo.outputPath("M5-timing.txt"), run.stdout);
});
