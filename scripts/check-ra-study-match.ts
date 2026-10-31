import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { newGame, advance, ranking } from "../src/game/engine.ts";
const directory =
    process.argv[2] ?? "artifacts/ai-ra-literature-study-20261028",
  stem = process.argv.includes("--smoke") ? "match-smoke" : "match";
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const planBytes = await readFile(join(directory, stem + "-plan.json")),
  plan = JSON.parse(planBytes.toString());
const result = JSON.parse(
  await readFile(join(directory, stem + "-results.json"), "utf8"),
);
assert.equal(result.status, "complete");
assert.equal(result.completed, plan.jobs.length);
assert.equal(result.total, plan.jobs.length);
assert.equal(result.active.length, 0);
assert.equal(result.planSha256, sha(planBytes));
for (const [file, hash] of Object.entries(plan.hashes))
  assert.equal(sha(await readFile(file)), hash, file);
const key = (j: any) => `${j.configuration}/${j.seed}/${j.count}/${j.seat}`;
assert.deepEqual(result.results.map(key).sort(), plan.jobs.map(key).sort());
let decisions = 0,
  replaySteps = 0;
const summaries = [];
for (const c of plan.configurations) {
  const rows = result.results.filter((r: any) => r.configuration === c.name);
  const aggregate = {
    candidate: {
      decisions: 0,
      searched: 0,
      searchMs: 0,
      samples: 0,
      truncated: 0,
      plannedCutoffs: 0,
    },
    opponent: {
      decisions: 0,
      searched: 0,
      searchMs: 0,
      samples: 0,
      truncated: 0,
      plannedCutoffs: 0,
    },
  };
  for (const row of rows) {
    const bytes = await readFile(row.replayPath);
    assert.equal(sha(bytes), row.replaySha256);
    const trace = JSON.parse(bytes.toString());
    assert.equal(trace.audit.metadata.planSha256, sha(planBytes));
    assert.equal(trace.audit.metadata.probeSha256, plan.probeSha256);
    assert.deepEqual(trace.audit.metadata.job, {
      seed: row.seed,
      count: row.count,
      seat: row.seat,
      configuration: row.configuration,
    });
    assert.equal(trace.config.seed, row.seed);
    assert.equal(trace.config.count, row.count);
    let state = newGame(trace.config);
    const stats = {
      candidate: {
        decisions: 0,
        searched: 0,
        searchMs: 0,
        samples: 0,
        truncated: 0,
        plannedCutoffs: 0,
      },
      opponent: {
        decisions: 0,
        searched: 0,
        searchMs: 0,
        samples: 0,
        truncated: 0,
        plannedCutoffs: 0,
      },
    };
    assert.equal(trace.actions.length, trace.audit.decisions.length);
    for (let step = 0; step < trace.actions.length; step++) {
      const d = trace.audit.decisions[step],
        report = d.report,
        side = state.current === row.seat ? "candidate" : "opponent",
        spec = side === "candidate" ? c : plan.baseline;
      assert.equal(d.player, state.current);
      assert.equal(d.step, step + 1);
      assert.equal(d.epoch, state.epoch);
      assert.equal(d.phase, state.phase);
      assert.deepEqual(report.action, trace.actions[step]);
      assert.equal(report.study.configuration, spec.name);
      assert.equal(report.study.timeMs, plan.timeMs);
      assert.equal(report.study.horizon, "next-epoch");
      assert.equal(
        report.samples,
        report.candidates.reduce((v: number, c: any) => v + c.visits, 0),
      );
      assert.equal(
        report.study.plannedCutoffs,
        Math.trunc(report.study.plannedCutoffs),
      );
      assert.ok(
        report.study.plannedCutoffs >= 0 &&
          report.study.plannedCutoffs <= report.samples,
      );
      if (spec.rollout < 0) assert.equal(report.study.plannedCutoffs, 0);
      const s = stats[side];
      s.decisions++;
      if (report.samples) {
        s.searched++;
        s.searchMs += d.elapsedMs;
        assert.ok(d.elapsedMs >= plan.timeMs * 0.95);
      }
      s.samples += report.samples;
      s.truncated += report.truncated;
      s.plannedCutoffs += report.study.plannedCutoffs;
      state = advance(state, trace.actions[step]);
      decisions++;
      replaySteps++;
    }
    assert.equal(state.phase, "over");
    assert.equal(state.steps, row.steps);
    assert.deepEqual(ranking(state), row.ranking);
    assert.deepEqual(state.history, trace.audit.history);
    assert.equal(sha(JSON.stringify(trace.actions)), trace.audit.actionsSha256);
    const rank = ranking(state).findIndex((r) => r.player === row.seat) + 1;
    assert.equal(row.rank, rank);
    assert.equal(row.rankingScore, (row.count - rank) / (row.count - 1));
    for (const side of ["candidate", "opponent"] as const)
      for (const field of [
        "decisions",
        "searched",
        "searchMs",
        "samples",
        "truncated",
        "plannedCutoffs",
      ] as const) {
        if (!(
          plan.smoke &&
          field === "searchMs" &&
          row.stats[side][field] === undefined
        ))
          assert.equal(stats[side][field], row.stats[side][field]);
        aggregate[side][field] += stats[side][field];
      }
  }
  const byCount = [2, 3, 4, 5]
    .filter((count) => plan.jobs.some((j: any) => j.count === count))
    .map((count) => {
      const r = rows.filter((r: any) => r.count === count);
      return {
        count,
        games: r.length,
        meanRank: r.reduce((v: number, r: any) => v + r.rank, 0) / r.length,
        rankingScore:
          r.reduce((v: number, r: any) => v + r.rankingScore, 0) / r.length,
        first: r.filter((r: any) => r.rank === 1).length,
      };
    });
  const score =
    byCount.reduce((s, r) => s + r.rankingScore, 0) / byCount.length;
  const bySeed = [...new Set<number>(rows.map((r: any) => r.seed))].map(
    (seed) => {
      const r = rows.filter((r: any) => r.seed === seed);
      return {
        seed,
        rankingScore:
          byCount.reduce((s, { count }) => {
            const rows = r.filter((r: any) => r.count === count);
            return (
              s +
              rows.reduce((n: number, r: any) => n + r.rankingScore, 0) /
                rows.length
            );
          }, 0) / byCount.length,
      };
    },
  );
  summaries.push({
    configuration: c.name,
    games: rows.length,
    rankingScore: score,
    byCount,
    bySeed,
    stats: aggregate,
  });
}
const summary = {
  status: "complete-verified",
  planSha256: sha(planBytes),
  games: result.results.length,
  decisions,
  replaySteps,
  summaries,
  confidenceInterval: null,
  reason: plan.smoke
    ? "Smoke only; excluded from playing-strength results"
    : "Only two independent base seeds; pilot descriptive results, no confirmatory interval or2s strength claim",
  productionChanged: false,
  modelsChanged: false,
};
await writeFile(
  join(directory, stem + "-verified.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
