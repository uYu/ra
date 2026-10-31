import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";
import type { SearchReport, SearchOptions } from "../src/game/ai/search.ts";
import type { State } from "../src/game/types.ts";
const output = process.argv[2] ?? "artifacts/ai-ra-literature-study-20261028";
const plan = JSON.parse(await readFile(join(output, "plan.json"), "utf8"));
const ai = await createWasmAi(await readFile(join(output, "probe.wasm"))),
  native = (ai as any).native;
let source = await readFile("src/game/ai/search.ts", "utf8");
function replace(a: string, b: string) {
  assert.equal(source.split(a).length - 1, 1, a);
  source = source.replace(a, b);
}
source = source.replace(
  /from "(\.[^"]+)"/g,
  (_, path) => `from "${pathToFileURL(resolve("src/game/ai", path)).href}"`,
);
source += `\nlet studyAlpha=.5,studyC=1.4,studyRollout=-1;export let studyMetrics={plannedCutoffs:0,rolloutTransitions:0};export function configureStudy(a:number,c:number,r:number){studyAlpha=a;studyC=c;studyRollout=r;studyMetrics={plannedCutoffs:0,rolloutTransitions:0};}\n`;
replace(
  "Math.ceil(2 * Math.sqrt(branch.visits + 1))",
  "Math.ceil(2 * Math.pow(branch.visits + 1,studyAlpha))",
);
replace(
  "Math.ceil(2 * Math.sqrt(edge.visits + 1))",
  "Math.ceil(2 * Math.pow(edge.visits + 1,studyAlpha))",
);
replace(
  "1.4 * Math.sqrt(Math.log(branch.visits + 1) / e.visits)",
  "studyC * Math.sqrt(Math.log(branch.visits + 1) / e.visits)",
);
replace(
  "    while (!finished(next) && steps < stepLimit) {\n      const actions = options.rolloutModel",
  "    let rolloutSteps=0;\n    while (!finished(next) && steps < stepLimit && (studyRollout<0||rolloutSteps<studyRollout)) {\n      const actions = options.rolloutModel",
);
replace(
  '        if (finished(next) || steps >= stepLimit) break;\n        if (next.phase === "epoch")',
  '        if (finished(next) || steps >= stepLimit || (studyRollout>=0&&rolloutSteps>=studyRollout)) break;\n        rolloutSteps++;\n        if (next.phase === "epoch")',
);
replace(
  "    if (!finished(next)) truncated++;\n    const residual =",
  "    if (!finished(next)) {if(studyRollout>=0&&rolloutSteps>=studyRollout)studyMetrics.plannedCutoffs++;else truncated++;}\n    studyMetrics.rolloutTransitions+=rolloutSteps;\n    const residual =",
);
const directory = await mkdtemp(join(tmpdir(), "ra-dpw-reference-"));
try {
  await writeFile(join(directory, "reference.ts"), source);
  const reference = (await import(
    pathToFileURL(join(directory, "reference.ts")).href
  )) as {
    configureStudy(a: number, c: number, r: number): void;
    searchAction(s: State, options: SearchOptions): SearchReport;
    studyMetrics: { plannedCutoffs: number; rolloutTransitions: number };
  };
  const positions = JSON.parse(
    await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
  ) as { state: State }[];
  let checks = 0;
  for (const c of plan.configurations)
    for (const p of positions) {
      const s = observe(p.state),
        before = structuredClone(s),
        options = {
          samples: 4,
          horizon: "next-epoch" as const,
          variant: c.variant,
        };
      native.configure_study(c.alpha, c.exploration, c.rollout);
      reference.configureStudy(c.alpha, c.exploration, c.rollout);
      const actual = ai.search(s, options),
        expected = reference.searchAction(s, options);
      const metrics = new Float64Array(
        native.memory.buffer,
        native.study_metrics(),
        4,
      );
      assert.equal(metrics[0], reference.studyMetrics.plannedCutoffs);
      assert.equal(metrics[1], reference.studyMetrics.rolloutTransitions);
      for (const r of [actual, expected])
        for (const candidate of r.candidates) {
          candidate.value = Math.round(candidate.value * 1e7) / 1e7;
          candidate.error = Math.round(candidate.error * 1e7) / 1e7;
        }
      assert.deepEqual(
        actual,
        expected,
        `${c.name}/${p.state.config.count}/${p.state.epoch}/${p.state.phase}`,
      );
      assert.deepEqual(s, before);
      checks++;
      const hidden = structuredClone(p.state);
      hidden.bag.reverse();
      hidden.config.seed ^= 12345;
      hidden.players.forEach((p, i) => (p.score = 800 + i));
      native.configure_study(c.alpha, c.exploration, c.rollout);
      const masked = ai.search(hidden, options);
      for (const candidate of masked.candidates) {
        candidate.value = Math.round(candidate.value * 1e7) / 1e7;
        candidate.error = Math.round(candidate.error * 1e7) / 1e7;
      }
      assert.deepEqual(actual, masked);
    }
  const result = {
    checks,
    hiddenInformationChecks: checks,
    sourceImmutable: true,
    metricsAgree: true,
    passed: true,
  };
  await writeFile(
    join(output, "reference-checks.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(result);
} finally {
  await rm(directory, { recursive: true, force: true });
}
