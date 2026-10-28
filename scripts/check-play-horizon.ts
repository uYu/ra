import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { hardSearchHorizon } from "../src/game/ai.ts";
import { legalActions } from "../src/game/engine.ts";
import type { State } from "../src/game/types.ts";
const output = process.argv[2] ?? "artifacts/ai-play-cross-epoch-20261028.json";
const bytes = await readFile("src/game/ai/ra-ai.wasm");
const ai = await createWasmAi(bytes);
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
);
assert.equal(hardSearchHorizon, "next-epoch");
const results = [];
for (const count of [2, 3, 4, 5])
  for (const epoch of [1, 2]) {
    const position = positions.find(
      (p) => p.count === count && p.epoch === epoch && p.phase === "turn",
    )!;
    const state = position.state,
      before = structuredClone(state);
    const rows: any = {};
    for (const horizon of ["epoch", hardSearchHorizon] as const) {
      ai.search(state, { samples: 2, horizon });
      const started = performance.now();
      const r = ai.search(state, { horizon, timeMs: 2000 });
      const elapsedMs = performance.now() - started;
      assert.ok(elapsedMs >= 1900 && elapsedMs < 4000);
      assert.ok(r.samples > 0 && r.samples < 1e6);
      assert.ok(
        legalActions(state).some(
          (a) => JSON.stringify(a) === JSON.stringify(r.action),
        ),
      );
      assert.ok(
        r.candidates.every((c) => c.visits >= 1 && Number.isFinite(c.value)),
      );
      assert.deepEqual(state, before);
      if (horizon === "epoch") assert.equal(r.epochAdvances, 0);
      else assert.ok(r.epochAdvances > 0);
      rows[horizon] = {
        elapsedMs,
        samples: r.samples,
        transitions: r.transitions,
        epochAdvances: r.epochAdvances,
        completed: r.completed,
        truncated: r.truncated,
        action: r.action,
      };
    }
    results.push({ count, rootEpoch: epoch, steps: state.steps, ...rows });
    console.log(
      JSON.stringify({
        count,
        epoch,
        epochSamples: rows.epoch.samples,
        nextEpochSamples: rows["next-epoch"].samples,
        truncated: rows["next-epoch"].truncated,
      }),
    );
  }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const report = {
  createdAt: new Date().toISOString(),
  horizon: hardSearchHorizon,
  timeMs: 2000,
  wasmSha256: createHash("sha256").update(bytes).digest("hex"),
  results,
  summary: {
    positions: results.length,
    epochMeanSamples: mean(results.map((r: any) => r.epoch.samples)),
    nextEpochMeanSamples: mean(
      results.map((r: any) => r["next-epoch"].samples),
    ),
    epochMeanMs: mean(results.map((r: any) => r.epoch.elapsedMs)),
    nextEpochMeanMs: mean(results.map((r: any) => r["next-epoch"].elapsedMs)),
    nextEpochTruncated: results.reduce(
      (n, r: any) => n + r["next-epoch"].truncated,
      0,
    ),
  },
  caveat:
    "Same-position horizon diagnostic on eight saved turn positions, one timing per configuration; not a playing-strength comparison or a representative average. Low-level historical API default remains epoch; playable hard AI explicitly selects next-epoch.",
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
