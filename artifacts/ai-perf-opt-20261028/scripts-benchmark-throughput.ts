import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import type { State } from "../src/game/types.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const output = args.get("--out") ?? "artifacts/ai-perf-opt-20261028.json";
try {
  await access(output);
  throw new Error(`Choose a new output: ${output}`);
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
const integer = (key: string, fallback: number, max: number) => {
  const n = Number(args.get(key) ?? fallback);
  assert.ok(Number.isInteger(n) && n > 0 && n <= max, key);
  return n;
};
const fixedSamples = integer("--samples", 128, 512);
const fixedRepeats = integer("--fixed-repeats", 3, 20);
const timedRepeats = integer("--time-repeats", 2, 10);
const timeMs = integer("--time-ms", 2000, 2000);
const baselinePath =
  args.get("--baseline") ??
  "artifacts/ai-uct2s-source-snapshot/src/game/ai/ra-ai.wasm";
const positionsPath =
  args.get("--positions") ?? "artifacts/ai-perf-20261028/positions.json";
const sha = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const [oldBytes, newBytes, positionBytes] = await Promise.all([
  readFile(baselinePath),
  readFile("src/game/ai/ra-ai.wasm"),
  readFile(positionsPath),
]);
const old = await createWasmAi(oldBytes),
  current = await createWasmAi(newBytes);
const backends = { baseline: old, optimized: current };
const positions: {
  count: number;
  epoch: number;
  phase: string;
  state: State;
}[] = JSON.parse(positionBytes.toString());
assert.equal(positions.length, 24);
for (const count of [2, 3, 4, 5])
  for (const epoch of [1, 2, 3])
    for (const phase of ["turn", "auction"])
      assert.equal(
        positions.filter(
          (p) => p.count === count && p.epoch === epoch && p.phase === phase,
        ).length,
        1,
      );
const fixedOptions = {
  samples: fixedSamples,
  horizon: "epoch" as const,
  variant: "uct" as const,
};
for (const p of positions) {
  for (const ai of [old, current]) ai.search(p.state, { samples: 8 });
  const before = structuredClone(p.state);
  assert.deepEqual(
    current.search(p.state, fixedOptions),
    old.search(p.state, fixedOptions),
    `Search diverged at ${p.count}/${p.epoch}/${p.phase}`,
  );
  assert.deepEqual(p.state, before);
}
console.log(
  JSON.stringify({ stage: "equivalence-passed", positions: positions.length }),
);
type Row = {
  mode: string;
  backend: string;
  position: number;
  count: number;
  epoch: number;
  phase: string;
  repeat: number;
  ms: number;
  samples: number;
  transitions: number;
  depth: number;
};
const rows: Row[] = [];
for (const mode of ["fixed", "time"])
  for (
    let repeat = 0;
    repeat < (mode === "fixed" ? fixedRepeats : timedRepeats);
    repeat++
  )
    for (let index = 0; index < positions.length; index++) {
      const p = positions[index];
      const order =
        (index + repeat) % 2
          ? (["optimized", "baseline"] as const)
          : (["baseline", "optimized"] as const);
      const reports = [];
      for (const backend of order) {
        const start = performance.now();
        const result = backends[backend].search(p.state, {
          ...fixedOptions,
          ...(mode === "time" ? { timeMs } : {}),
        });
        const ms = performance.now() - start;
        if (mode === "time") {
          assert.ok(ms >= timeMs * 0.95);
          assert.ok(result.samples < 1_000_000, "Iteration safety cap reached");
        }
        rows.push({
          mode,
          backend,
          position: index,
          count: p.count,
          epoch: p.epoch,
          phase: p.phase,
          repeat,
          ms,
          samples: result.samples,
          transitions: result.transitions,
          depth: result.depth,
        });
        reports.push(result);
      }
      if (mode === "fixed") assert.deepEqual(reports[0], reports[1]);
      if (mode === "time")
        console.log(
          JSON.stringify({
            stage: "timed-pair",
            position: index,
            count: p.count,
            epoch: p.epoch,
            phase: p.phase,
            repeat,
            baseline: rows.slice(-2).find((r) => r.backend === "baseline")!
              .samples,
            optimized: rows.slice(-2).find((r) => r.backend === "optimized")!
              .samples,
          }),
        );
    }
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (count?: number) => {
  const selected = rows.filter((r) => count === undefined || r.count === count);
  const cell = (mode: string, backend: string) => {
    const rs = selected.filter((r) => r.mode === mode && r.backend === backend);
    return {
      calls: rs.length,
      meanMs: mean(rs.map((r) => r.ms)),
      totalMs: rs.reduce((n, r) => n + r.ms, 0),
      meanSamples: mean(rs.map((r) => r.samples)),
      medianSamples: median(rs.map((r) => r.samples)),
      meanTransitions: mean(rs.map((r) => r.transitions)),
    };
  };
  const fixedBaseline = cell("fixed", "baseline"),
    fixedOptimized = cell("fixed", "optimized");
  const timedBaseline = cell("time", "baseline"),
    timedOptimized = cell("time", "optimized");
  const ratios = selected
    .filter((r) => r.mode === "time" && r.backend === "baseline")
    .map(
      (r) =>
        selected.find(
          (x) =>
            x.mode === r.mode &&
            x.backend === "optimized" &&
            x.position === r.position &&
            x.repeat === r.repeat,
        )!.samples / r.samples,
    );
  return {
    count: count ?? "all",
    fixedBaseline,
    fixedOptimized,
    fixedLatencySpeedup: fixedBaseline.totalMs / fixedOptimized.totalMs,
    timedBaseline,
    timedOptimized,
    timedMeanSamplesRatio:
      timedOptimized.meanSamples / timedBaseline.meanSamples,
    timedPairMedianRatio: median(ratios),
    timedPairMinRatio: Math.min(...ratios),
    timedPairMaxRatio: Math.max(...ratios),
  };
};
const report = {
  createdAt: new Date().toISOString(),
  status: "complete",
  positions: positions.length,
  positionsPath,
  positionsSha256: sha(positionBytes),
  baselinePath,
  baselineSha256: sha(oldBytes),
  optimizedSha256: sha(newBytes),
  optimizedSourceSha256: sha(await readFile("native/ra_ai.cpp")),
  bridgeSha256: sha(await readFile("src/game/ai/wasm.ts")),
  fixedSamples,
  fixedRepeats,
  timedRepeats,
  timeMs,
  identicalFixedBudgetReports: true,
  noTournamentGames: true,
  methodology:
    "Serial paired searches on the same 24 public positions, warmed both backends, AB/BA order alternating by position and repetition. Fixed work validates full reports and latency; timed work measures samples completed in equal soft deadlines. No CPU profiler during measurements.",
  limitations:
    "A deterministic representative position suite is not a playing-strength test. Timed counts fluctuate with scheduling and evolving tree costs; raw rows retained. Prior tournament/replay outputs and frozen baseline are unchanged.",
  overall: summarize(),
  byCount: [2, 3, 4, 5].map(summarize),
  rows,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      stage: "complete",
      output,
      overall: report.overall,
      byCount: report.byCount,
    },
    null,
    2,
  ),
);
