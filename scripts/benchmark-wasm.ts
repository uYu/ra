import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, simulate } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { policyAction, candidateActions } from "../src/game/ai/policy.ts";
import { searchAction } from "../src/game/ai/search.ts";
import type { State } from "../src/game/types.ts";
const bytes = await readFile(
  new URL("../src/game/ai/ra-ai.wasm", import.meta.url),
);
const init = performance.now(),
  native = await createWasmAi(bytes),
  instantiateMs = performance.now() - init;
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    humans: 0,
    difficulty: "normal",
    seed: 9500 + count,
  });
  const epochs = [0, 0, 0];
  while (s.phase !== "over" && s.steps < 1500) {
    if (
      s.steps % 7 === 0 &&
      epochs[s.epoch - 1] < 2 &&
      candidateActions(s).length > 1
    ) {
      positions.push(s);
      epochs[s.epoch - 1]++;
    }
    s = simulate(s, policyAction(s));
  }
}
const options = { samples: 32 };
searchAction(observe(positions[0]), { samples: 4 });
native.search(positions[0], { samples: 4 });
const rows = [];
for (let i = 0; i < positions.length; i++) {
  const s = positions[i],
    result = new Map();
  for (const backend of i % 2
    ? ["typescript", "wasm"]
    : ["wasm", "typescript"]) {
    const started = performance.now();
    const report =
      backend === "wasm"
        ? native.search(s, options)
        : searchAction(observe(s), options);
    const row = {
      backend,
      position: i,
      count: s.config.count,
      epoch: s.epoch,
      phase: s.phase,
      ms: performance.now() - started,
      samples: report.samples,
      transitions: report.transitions,
      nodes: report.nodes,
      depth: report.depth,
      action: report.action,
    };
    result.set(backend, report);
    rows.push(row);
  }
  const a = result.get("typescript"),
    b = result.get("wasm");
  if (
    JSON.stringify(a.action) !== JSON.stringify(b.action) ||
    a.transitions !== b.transitions ||
    a.nodes !== b.nodes
  )
    throw new Error(
      `Native search diverged at ${s.config.count}/${s.epoch}/${s.steps}`,
    );
  for (let j = 0; j < a.candidates.length; j++) {
    const x = a.candidates[j],
      y = b.candidates[j];
    if (x.visits !== y.visits || Math.abs(x.value - y.value) > 1e-9)
      throw new Error(`Native candidate diverged at ${i}/${j}`);
  }
}
const summary = ["typescript", "wasm"].map((backend) => {
  const selected = rows.filter((r) => r.backend === backend),
    times = selected.map((r) => r.ms).sort((a, b) => a - b);
  return {
    backend,
    positions: selected.length,
    samples: selected.reduce((n, r) => n + r.samples, 0),
    totalMs: times.reduce((a, b) => a + b, 0),
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
  };
});
const report = {
  wasmBytes: bytes.length,
  instantiateMs,
  samplesPerRootAction: 32,
  summary,
  speedup: summary[0].totalMs / summary[1].totalMs,
  identicalActions: true,
  identicalTreeCounts: true,
  rows,
};
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
