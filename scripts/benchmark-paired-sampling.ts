import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { legalActions } from "../src/game/engine.ts";
import type { State } from "../src/game/types.ts";
const directory = "artifacts/ai-paired-sampling-20261028";
const bytes = await readFile("src/game/ai/ra-ai.wasm"),
  ai = await createWasmAi(bytes);
const baseline = await createWasmAi(
  await readFile(directory + "/baseline.wasm"),
);
const recorded: State = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
);
const positions = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
) as { state: State; count: number; epoch: number; phase: string }[];
const actionKey = (a: unknown) => JSON.stringify(a);
const fixed = [];
for (const p of positions) {
  const options = { samples: 128, horizon: "next-epoch" as const };
  assert.deepEqual(
    ai.search(p.state, options),
    baseline.search(p.state, options),
  );
  const reports = [];
  for (const sampling of ["tree", "paired"] as const) {
    const start = performance.now(),
      report = ai.search(p.state, { ...options, sampling });
    assert.equal(
      report.samples,
      report.candidates.length === 1 ? 0 : 128 * report.candidates.length,
    );
    assert.ok(
      legalActions(p.state).some(
        (a) => actionKey(a) === actionKey(report.action),
      ),
    );
    reports.push({ sampling, ms: performance.now() - start, report });
  }
  fixed.push({ count: p.count, epoch: p.epoch, phase: p.phase, reports });
}
const exact = JSON.parse(
  await readFile(
    "artifacts/ai-search-exploration-20261028/oracle-checks.json",
    "utf8",
  ),
);
const prior = JSON.parse(
  await readFile(
    "artifacts/ai-endgame-oracle-legal-deck-20261028.json",
    "utf8",
  ),
);
const oracle: {
  index: number;
  offset: number;
  sampling: "tree" | "paired";
  action: ReturnType<typeof ai.search>["action"];
  regret: number;
  report: ReturnType<typeof ai.search>;
}[] = [];
for (const fixture of prior.results) {
  const known = exact.rows.find((r: any) => r.index === fixture.index).oracle;
  for (const offset of [0, 1000, 2000])
    for (const sampling of ["tree", "paired"] as const) {
      const s = { ...fixture.state, steps: fixture.state.steps + offset };
      const report = ai.search(s, {
        samples: 128,
        horizon: "next-epoch",
        sampling,
      });
      const value = known.rows.find(
        (r: any) => actionKey(r.action) === actionKey(report.action),
      )?.value;
      assert.ok(Number.isFinite(value));
      oracle.push({
        index: fixture.index,
        offset,
        sampling,
        action: report.action,
        regret: known.best - value,
        report,
      });
    }
}
const timed = [];
for (let repeat = 0; repeat < 3; repeat++)
  for (const sampling of repeat % 2
    ? (["paired", "tree"] as const)
    : (["tree", "paired"] as const)) {
    const start = performance.now(),
      report = ai.search(recorded, {
        sampling,
        timeMs: 2000,
        horizon: "next-epoch",
      });
    const row = { repeat, sampling, ms: performance.now() - start, report };
    timed.push(row);
    assert.ok(row.ms >= 1900);
    console.log(
      JSON.stringify({
        repeat,
        sampling,
        ms: row.ms,
        action: report.action,
        samples: report.samples,
        trainingSamples: report.trainingSamples,
        evaluationSamples: report.evaluationSamples,
      }),
    );
  }
const summary = {
  wasmSha256: createHash("sha256").update(bytes).digest("hex"),
  method:
    "Fixed total samples128 times candidates and separately total2000ms soft deadline; 75% training and 25% independent paired evaluation. Same horizon, reward, candidates and original policy. Three serial timed repeats on one recorded case, no tournament.",
  defaultEquivalencePositions: 24,
  oracleSummary: ["tree", "paired"].map((sampling) => {
    const r = oracle.filter((r) => r.sampling === sampling);
    return {
      sampling,
      searches: r.length,
      suboptimal: r.filter((r) => r.regret > 1e-9).length,
      meanUtilityRegret: r.reduce((s, r) => s + r.regret, 0) / r.length,
      maxUtilityRegret: Math.max(...r.map((r) => r.regret)),
    };
  }),
  fixed,
  timed,
  oracle,
  caveats: [
    "Twenty small synthetic oracle positions predate this change but are easy; not playing-strength evidence.",
    "Same-state repeated timing is not independent game-level evidence.",
    "Paired candidate values/utility errors come from the independent evaluation phase only. Candidate visits and total counters include both phases.",
    "Complete evaluation rounds may exceed the soft deadline; forced actions skip sampling.",
  ],
};
await writeFile(
  directory + "/summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify({ oracleSummary: summary.oracleSummary }, null, 2));
