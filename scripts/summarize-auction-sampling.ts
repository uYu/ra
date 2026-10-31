import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const dir = resolve(
  process.argv[2] ?? "artifacts/ai-auction-sampling-20261029",
);
const load = async (n: string) =>
  JSON.parse(await readFile(join(dir, n), "utf8"));
const [build, qa, verified, results] = await Promise.all(
  ["build.json", "qa.json", "match-verified.json", "match-results.json"].map(
    load,
  ),
);
assert.equal(verified.status, "complete-verified");
assert.equal(results.status, "complete");
assert.equal(results.total, 28);
const sha = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
assert.equal(
  sha(await readFile("src/game/ai/ra-ai.wasm")),
  build.baselineSha256,
);
assert.equal(sha(await readFile("native/ra_ai.cpp")), build.sourceSha256);
assert.equal(
  sha(await readFile("scripts/auction-sampling/probe.inc")),
  build.extensionSha256,
);
const phaseRows: any[] = [];
for (const r of results.results) {
  const trace = JSON.parse(await readFile(r.replayPath, "utf8"));
  for (const d of trace.audit.decisions)
    if (d.report.study.auctionMode)
      phaseRows.push({
        count: r.count,
        ms: d.elapsedMs,
        rounds: d.report.study.auctionRounds,
        outcomes: d.report.study.distinctOutcomes,
        nodes: d.report.study.auctionNodes,
        samples: d.report.samples,
        truncated: d.report.truncated,
      });
}
const average = (rows: any[], k: string) =>
  rows.reduce((s, x) => s + x[k], 0) / rows.length;
const report = {
  scope: build.scope,
  method:
    "Full official Ra games, one candidate seat vs original UCT in all other seats, both 200ms/decision and next-epoch horizon, two base seeds with all 2–5-player seats. Candidate changes ONLY auction decisions with multiple legal bids. No model or reward changes. Complete legal auction tree; distinct winner/disk leaves share public random scenarios. Backward induction after averaging uses each bidder own unchanged relative/tanh utility. Future continuations retain old heuristic policy. Not full multi-auction MCMS and no general optimality claim.",
  validation: {
    defaultEquivalencePositions: qa.defaults,
    unchangedNonAuctionPositions: qa.unchanged,
    independentTSComparisons: qa.comparisons.length,
    hiddenInformationChecks: qa.hidden,
    forcedBidChecks: qa.forced,
    smokeGames: 4,
    formalGames: verified.games,
    verifiedActions: verified.replaySteps,
    productionUnchanged: true,
  },
  results: verified.summaries,
  auctionMetrics: [2, 3, 4, 5].map((count) => {
    const a = phaseRows.filter((x) => x.count === count);
    return {
      count,
      decisions: a.length,
      meanMs: average(a, "ms"),
      meanPairedRounds: average(a, "rounds"),
      meanDistinctOutcomes: average(a, "outcomes"),
      meanAuctionNodes: average(a, "nodes"),
      truncated: a.reduce((s, x) => s + x.truncated, 0),
    };
  }),
  serial2sDiagnostics: qa.timed,
  limitations: [
    "Only two independent base seeds; no confirmatory confidence interval or2s strength conclusion.",
    "One current auction is solved against policy-based future values; future policy bias is not removed.",
    "Counterfactual leaf payoff uncertainty and selection effects are not equilibrium confidence intervals.",
    "Reported samples count distinct leaf rollouts; cannot compare directly to UCT simulations on different game states.",
  ],
};
await writeFile(
  join(dir, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      validation: report.validation,
      results: report.results,
      auctionMetrics: report.auctionMetrics,
    },
    null,
    2,
  ),
);
