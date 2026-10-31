import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { legalActions, simulate } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import {
  enumerateAuction,
  referenceSearch,
} from "./auction-sampling/reference.ts";
import type { State } from "../src/game/types.ts";
const dir = resolve(process.argv[2] ?? "artifacts/ai-auction-turn-20261030");
const ai = await createWasmAi(await readFile(join(dir, "probe.wasm")));
const old = await createWasmAi(
  await readFile("artifacts/ai-auction-2s-20261029/probe.wasm"),
);
const uncached = await createWasmAi(
  await readFile("artifacts/ai-auction-turn-20261030/probe.wasm"),
);
const uncachedNative = (uncached as any).native;
const native = (ai as any).native;
const oldNative = (old as any).native;
const metrics = () => [
  ...new Float64Array(native.memory.buffer, native.turn_auction_metrics(), 8),
];
const corpus = JSON.parse(
  await readFile("artifacts/ai-perf-20261028/positions.json", "utf8"),
) as { state: State }[];
let baselineMatches = 0,
  planChecks = 0,
  hiddenChecks = 0,
  turnChecks = 0;
const fixed: any[] = [],
  timed: any[] = [];
for (const { state } of corpus) {
  for (const mode of [0, 1]) {
    native.configure_auction_study(mode);
    oldNative.configure_auction_study(mode);
    assert.deepEqual(
      ai.search(state, { samples: 2, horizon: "next-epoch" }),
      old.search(state, { samples: 2, horizon: "next-epoch" }),
    );
    baselineMatches++;
  }
  native.configure_auction_study(2);
  const before = structuredClone(state);
  const actual = ai.search(state, { samples: 2, horizon: "next-epoch" });
  const m = metrics();
  assert.deepEqual(state, before);
  assert.ok(
    legalActions(state).some(
      (a) => JSON.stringify(a) === JSON.stringify(actual.action),
    ),
  );
  if (state.phase === "auction" && legalActions(state).length > 1) {
    const ref = referenceSearch(state, 2, "next-epoch");
    assert.deepEqual(actual.action, ref.action);
    const table = new Float64Array(
      native.memory.buffer,
      native.auction_study_leaves(),
      1024,
    );
    const tree = enumerateAuction(observe(state));
    let offset = 2;
    for (const leaf of tree.leaves) {
      assert.equal(table[offset++], leaf.winner);
      assert.equal(table[offset++], leaf.sun);
      for (let i = 0; i < state.players.length; i++) {
        assert.ok(
          Math.abs(
            table[offset++] - ref.leaves[tree.leaves.indexOf(leaf)].raw[i] / 2,
          ) < 1e-7,
        );
        leaf.utility.push(table[offset++]);
      }
      leaf.utility.splice(0, state.players.length);
    }
    const solve = (id: number): number => {
      const node = tree.nodes[id];
      if (node.leaf >= 0) return node.leaf;
      let best = -1;
      for (const child of node.children) {
        const leaf = solve(child);
        if (
          best < 0 ||
          tree.leaves[leaf].utility[node.actor] >
            tree.leaves[best].utility[node.actor] + 1e-12
        )
          best = leaf;
      }
      return best;
    };
    const plan = [
      ...new Float64Array(native.memory.buffer, native.turn_auction_plan(), 8),
    ];
    let id = 0,
      next = observe(state);
    for (let j = 0; j < plan[0]; j++) {
      const node = tree.nodes[id];
      let best = 0;
      for (let k = 1; k < node.children.length; k++)
        if (
          tree.leaves[solve(node.children[k])].utility[node.actor] >
          tree.leaves[solve(node.children[best])].utility[node.actor] + 1e-12
        )
          best = k;
      const action = node.actions[best];
      assert.equal(action.type, "bid");
      if (action.type !== "bid") throw Error("bid expected");
      assert.equal(plan[j + 1], action.sun ?? -1);
      next = simulate(next, action);
      id = node.children[best];
    }
    assert.ok(tree.nodes[id].leaf >= 0);
    assert.notEqual(next.phase, "auction");
    planChecks++;
  }
  if (state.phase === "turn") {
    uncachedNative.configure_auction_study(2);
    assert.deepEqual(
      actual,
      uncached.search(state, { samples: 2, horizon: "next-epoch" }),
    );
    assert.ok(m[0] > 0);
    assert.equal(m[1], m[0] * 8);
    assert.ok(
      m[0] + m[7] <= actual.samples,
      "at most one sampled auction per outer simulation",
    );
    assert.equal(m[4], 0);
    turnChecks++;
    fixed.push({
      count: state.players.length,
      epoch: state.epoch,
      outerSamples: actual.samples,
      inner: m,
    });
  } else assert.equal(m[0], 0);
  const changed = structuredClone(state);
  changed.bag.reverse();
  changed.config.seed += 551;
  changed.players.forEach((p, i) => (p.score += 71 + i * 97));
  assert.deepEqual(
    ai.search(changed, { samples: 2, horizon: "next-epoch" }),
    actual,
  );
  hiddenChecks++;
}
for (const { state } of corpus.filter(
  (x) => x.state.phase === "turn" && x.state.epoch === 2,
)) {
  for (const mode of [1, 2]) {
    native.configure_auction_study(mode);
    const start = performance.now(),
      report = ai.search(state, { timeMs: 2000, horizon: "next-epoch" }),
      ms = performance.now() - start;
    assert.ok(ms >= 1900);
    assert.ok(ms < 2400, `excessive budget overrun: ${ms}`);
    assert.equal(report.truncated, 0);
    assert.equal(metrics()[4], 0);
    timed.push({
      count: state.players.length,
      mode,
      ms,
      samples: report.samples,
      inner: metrics(),
    });
  }
}
const result = {
  status: "verified",
  baselineMatches,
  planChecks,
  hiddenChecks,
  turnChecks,
  fixed,
  timed,
  productionSha256: createHash("sha256")
    .update(await readFile("src/game/ai/ra-ai.wasm"))
    .digest("hex"),
};
await writeFile(join(dir, "qa.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, fixed: undefined }, null, 2));
