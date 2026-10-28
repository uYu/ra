import { writeFileSync } from "node:fs";
import { newGame, simulate } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { policyAction, candidateActions } from "../src/game/ai/policy.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { searchAction as previous } from "../tests/fixtures/previous-mcts.ts";
import type { State } from "../src/game/types.ts";

// Identical public positions and identical iteration budgets. Alternate the
// execution order to reduce warmup/order bias. This measures cost, not win rate.
const positions: State[] = [];
for (const count of [2, 3, 4, 5]) {
  let s = newGame({
    count,
    humans: 0,
    difficulty: "normal",
    seed: 9300 + count,
  });
  let collected = 0;
  const epochs = [0, 0, 0];
  while (s.phase !== "over" && collected < 6 && s.steps < 1500) {
    if (
      s.steps % 7 === 0 &&
      epochs[s.epoch - 1] < 2 &&
      candidateActions(s).length > 1
    ) {
      positions.push(observe(s));
      collected++;
      epochs[s.epoch - 1]++;
    }
    s = simulate(s, policyAction(s));
  }
}
// Warm both implementations before collecting timings.
previous(positions[0], { samples: 4 });
searchAction(positions[0], { samples: 4 });
const rows = positions.flatMap((s, i) => {
  const variants = i % 2 ? ["before", "after"] : ["after", "before"];
  return variants.map((variant) => {
    const started = performance.now();
    const report = (variant === "before" ? previous : searchAction)(s, {
      samples: 32,
    });
    return {
      variant,
      position: i,
      count: s.config.count,
      phase: s.phase,
      epoch: s.epoch,
      ms: performance.now() - started,
      samples: report.samples,
      transitions: report.transitions,
      nodes: report.nodes,
      depth: report.depth,
      action: report.action,
    };
  });
});
const summary = ["before", "after"].map((variant) => {
  const selected = rows.filter((r) => r.variant === variant);
  const times = selected.map((r) => r.ms).sort((a, b) => a - b);
  return {
    variant,
    positions: selected.length,
    samples: selected.reduce((n, r) => n + r.samples, 0),
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
    totalMs: times.reduce((a, b) => a + b, 0),
  };
});
const report = { samplesPerRootAction: 32, summary, rows };
console.log(JSON.stringify(summary, null, 2));
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
