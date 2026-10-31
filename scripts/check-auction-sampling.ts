import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { observe } from "../src/game/ai.ts";
import { legalActions, advance } from "../src/game/engine.ts";
import type { State } from "../src/game/types.ts";
import {
  enumerateAuction,
  referenceSearch,
  solveAuction,
} from "./auction-sampling/reference.ts";
const dir = resolve(
    process.argv[2] ?? "artifacts/ai-auction-sampling-20261029",
  ),
  ai = await createWasmAi(await readFile(join(dir, "probe.wasm"))),
  baseline = await createWasmAi(await readFile(join(dir, "baseline.wasm"))),
  native = (ai as any).native;
const corpus = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
) as { state: State }[];
const hash = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
function leaves(count: number) {
  const values = new Float64Array(
    native.memory.buffer,
    native.auction_study_leaves(),
    1024,
  );
  let offset = 0;
  const n = values[offset++],
    rounds = values[offset++];
  return {
    rounds,
    leaves: Array.from({ length: n }, () => ({
      winner: values[offset++],
      sun: values[offset++],
      values: Array.from({ length: count }, () => ({
        raw: values[offset++],
        utility: values[offset++],
      })),
    })),
  };
}
function close(a: number, b: number) {
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
}
const comparisons = [];
let defaults = 0,
  unchanged = 0,
  hidden = 0,
  forced = 0;
for (const { state } of corpus) {
  native.configure_auction_study(0);
  assert.deepEqual(
    ai.search(state, { samples: 4, horizon: "next-epoch" }),
    baseline.search(state, { samples: 4, horizon: "next-epoch" }),
  );
  defaults++;
  native.configure_auction_study(1);
  if (state.phase !== "auction") {
    assert.deepEqual(
      ai.search(state, { samples: 4, horizon: "next-epoch" }),
      baseline.search(state, { samples: 4, horizon: "next-epoch" }),
    );
    unchanged++;
    continue;
  }
  const before = structuredClone(state);
  for (const horizon of ["epoch", "next-epoch"] as const) {
    const actual = ai.search(state, { samples: 2, horizon });
    assert.deepEqual(state, before);
    if (legalActions(state).length === 1) {
      forced++;
      continue;
    }
    const table = leaves(state.players.length),
      reference = referenceSearch(state, 2, horizon);
    assert.equal(table.rounds, 2);
    assert.equal(table.leaves.length, reference.leaves.length);
    assert.equal(actual.samples, table.leaves.length * 2);
    assert.equal(actual.nodes, reference.nodes.length);
    assert.equal(actual.transitions, reference.transitions);
    assert.equal(actual.completed, reference.completed);
    assert.equal(actual.truncated, reference.truncated);
    assert.equal(actual.epochAdvances, reference.epochAdvances);
    for (let j = 0; j < table.leaves.length; j++) {
      const a = table.leaves[j],
        b = reference.leaves[j];
      assert.equal(a.winner, b.winner);
      assert.equal(a.sun, b.sun);
      for (let i = 0; i < state.players.length; i++) {
        close(a.values[i].raw, b.raw[i] / 2);
        close(a.values[i].utility, b.utility[i] / 2);
      }
    }
    // Rebuild the entire auction with TS rules, then back up NATIVE leaf
    // utilities. This checks all bidders, not only the selected root action.
    const independent = enumerateAuction(observe(state));
    independent.leaves.forEach((l, j) => {
      l.utility = table.leaves[j].values.map((x) => x.utility);
    });
    assert.deepEqual(solveAuction(independent, 1).action, actual.action);
    assert.deepEqual(reference.action, actual.action);
    comparisons.push({
      count: state.players.length,
      epoch: state.epoch,
      horizon,
      leaves: table.leaves.length,
      nodes: actual.nodes,
      samples: actual.samples,
    });
  }
  const original = ai.search(state, { samples: 3, horizon: "next-epoch" }),
    changed = structuredClone(state);
  changed.bag.reverse();
  changed.config.seed += 1109;
  changed.players.forEach((p, i) => (p.score += i * 91 + 37));
  assert.deepEqual(
    ai.search(changed, { samples: 3, horizon: "next-epoch" }),
    original,
  );
  hidden++;
  // Reach the caller with no prior bid; its voluntary-auction bid is mandatory.
  const caller = structuredClone(state);
  if (caller.auction!.reason === "invoke" && caller.auction!.high === 0) {
    let s = caller;
    while (s.phase === "auction" && s.current !== s.auction!.caller)
      s = advance(s, { type: "bid", sun: null });
    if (s.phase === "auction") {
      const report = ai.search(s, { samples: 2 });
      assert.ok(
        report.candidates.every(
          (c) => c.action.type === "bid" && c.action.sun !== null,
        ),
      );
      forced++;
    }
  }
}
// Exercise the real fixture only as a diagnostic, not as a selection criterion.
const fixture = JSON.parse(
  await readFile("tests/fixtures/last-bid-final-epoch.json", "utf8"),
) as State;
const timed = [];
for (const state of corpus
  .filter((x) => x.state.phase === "auction" && x.state.epoch === 2)
  .map((x) => x.state))
  for (const enabled of [0, 1]) {
    native.configure_auction_study(enabled);
    const t = performance.now(),
      r = ai.search(state, { timeMs: 2000, horizon: "next-epoch" }),
      ms = performance.now() - t;
    assert.ok(ms >= 1900);
    timed.push({
      count: state.players.length,
      enabled,
      ms,
      samples: r.samples,
      truncated: r.truncated,
      metrics: [
        ...new Float64Array(
          native.memory.buffer,
          native.auction_study_metrics(),
          8,
        ),
      ],
    });
  }
native.configure_auction_study(1);
const diagnostic = ai.search(fixture, { samples: 16, horizon: "next-epoch" });
const qa = {
  defaults,
  unchanged,
  hidden,
  forced,
  comparisons,
  timed,
  diagnostic,
  productionWasm: hash(await readFile("src/game/ai/ra-ai.wasm")),
  notes: [
    "Complete paired rounds can slightly exceed soft time limit.",
    "Reported candidate errors are conditional leaf standard errors, not equilibrium confidence intervals.",
    "Only current auction decisions change; future rollouts retain original policy.",
  ],
};
await writeFile(join(dir, "qa.json"), JSON.stringify(qa, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      defaults,
      unchanged,
      hidden,
      forced,
      comparisons: comparisons.length,
      timed: timed.map((x) => ({
        count: x.count,
        enabled: x.enabled,
        ms: x.ms,
      })),
      diagnostic: diagnostic.action,
    },
    null,
    2,
  ),
);
