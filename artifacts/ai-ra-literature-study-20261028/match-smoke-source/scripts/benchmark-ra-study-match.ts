import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  readdir,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, advance, ranking } from "../src/game/engine.ts";
import { random } from "../src/game/data.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
type Job = {
  seed: number;
  count: number;
  seat: number;
  configuration: "dpw-slow" | "dpw-slow-zero";
};
const key = (j: Job) => `${j.configuration}/${j.seed}/${j.count}/${j.seat}`;
const blank = () => ({
  decisions: 0,
  searched: 0,
  ms: 0,
  maxMs: 0,
  samples: 0,
  transitions: 0,
  truncated: 0,
  plannedCutoffs: 0,
  rolloutTransitions: 0,
});
if (!isMainThread) {
  const plan = JSON.parse(await readFile(workerData.planPath, "utf8"));
  for (const [path, hash] of Object.entries(plan.hashes))
    assert.equal(sha(await readFile(path)), hash, path);
  const ai = await createWasmAi(
      await readFile(join(plan.snapshot, "probe.wasm")),
    ),
    native = (ai as any).native;
  parentPort!.on("message", async (job: Job) => {
    try {
      let s = newGame({
        count: job.count,
        seed: job.seed,
        humans: 0,
        difficulty: "hard",
      });
      const recording = recorder(s.config),
        stats = { candidate: blank(), opponent: blank() };
      let lastProgress = 0;
      while (s.phase !== "over" && s.steps < 1600) {
        const candidate = s.current === job.seat,
          side = candidate ? "candidate" : "opponent",
          c = candidate
            ? plan.configurations.find((c: any) => c.name === job.configuration)
            : plan.baseline;
        native.configure_study(c.alpha, c.exploration, c.rollout);
        const start = performance.now(),
          report = ai.search(s, {
            timeMs: plan.timeMs,
            horizon: "next-epoch",
            variant: c.variant,
            reward: "relative",
          }),
          elapsed = performance.now() - start;
        const metrics = new Float64Array(
            native.memory.buffer,
            native.study_metrics(),
            4,
          ),
          row = stats[side];
        Object.assign(report, {
          study: {
            configuration: c.name,
            timeMs: plan.timeMs,
            horizon: "next-epoch",
            plannedCutoffs: metrics[0],
            rolloutTransitions: metrics[1],
          },
        });
        row.decisions++;
        row.ms += elapsed;
        row.maxMs = Math.max(row.maxMs, elapsed);
        row.samples += report.samples;
        row.transitions += report.transitions;
        row.truncated += report.truncated;
        row.plannedCutoffs += metrics[0];
        row.rolloutTransitions += metrics[1];
        if (report.samples) {
          row.searched++;
          assert.ok(elapsed >= plan.timeMs * 0.95);
        }
        recording.record(s, report, elapsed);
        s = advance(s, report.action);
        if (Date.now() - lastProgress > 5000) {
          lastProgress = Date.now();
          parentPort!.postMessage({
            progress: { job, steps: s.steps, epoch: s.epoch, stats },
          });
        }
      }
      assert.equal(s.phase, "over");
      const trace = recording.finish(s, {
        job,
        timeMs: plan.timeMs,
        horizon: "next-epoch",
        probeSha256: plan.probeSha256,
        planSha256: workerData.planSha256,
      });
      const path = join(
        plan.replays,
        job.configuration,
        `${job.seed}-${job.count}p-${job.seat}.json`,
      );
      await saveTrace(path, trace);
      const ranks = ranking(s),
        rank = ranks.findIndex((r) => r.player === job.seat) + 1;
      parentPort!.postMessage({
        done: {
          ...job,
          rank,
          ranking: ranks,
          rankingScore: (job.count - rank) / (job.count - 1),
          steps: s.steps,
          stats,
          replayPath: path,
          replaySha256: sha(JSON.stringify(trace) + "\n"),
        },
      });
    } catch (e) {
      parentPort!.postMessage({ error: String(e), job });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const directory = resolve(
      process.argv[2] ?? "artifacts/ai-ra-literature-study-20261028",
    ),
    smoke = process.argv.includes("--smoke"),
    stem = smoke ? "match-smoke" : "match";
  const planPath = join(directory, `${stem}-plan.json`),
    resultsPath = join(directory, `${stem}-results.json`);
  assert.ok(!existsSync(planPath), "Do not overwrite a frozen plan");
  const snapshot = join(directory, `${stem}-source`);
  await mkdir(join(snapshot, "src"), { recursive: true });
  await mkdir(join(snapshot, "scripts/lib"), { recursive: true });
  await cp("src/game", join(snapshot, "src/game"), { recursive: true });
  await cp(
    "scripts/lib/decision-trace.ts",
    join(snapshot, "scripts/lib/decision-trace.ts"),
  );
  await cp(
    fileURLToPath(import.meta.url),
    join(snapshot, "scripts/benchmark-ra-study-match.ts"),
  );
  await cp(join(directory, "probe.wasm"), join(snapshot, "probe.wasm"));
  await cp(join(directory, "probe.cpp"), join(snapshot, "probe.cpp"));
  const hashes: Record<string, string> = {};
  async function files(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await files(child);
      else hashes[child] = sha(await readFile(child));
    }
  }
  await files(snapshot);
  const configurations = [
      {
        name: "dpw-slow",
        variant: "dpw",
        alpha: 0.1,
        exploration: 1.4,
        rollout: -1,
      },
      {
        name: "dpw-slow-zero",
        variant: "dpw",
        alpha: 0.1,
        exploration: 1.4,
        rollout: 0,
      },
    ],
    baseline = {
      name: "uct-original",
      variant: "uct",
      alpha: 0.5,
      exploration: 1.4,
      rollout: -1,
    };
  const jobs: Job[] = [];
  for (const seed of smoke ? [1240999] : [1240001, 1240002])
    for (const count of smoke ? [2] : [2, 3, 4, 5])
      for (let seat = 0; seat < count; seat++)
        for (const c of configurations)
          jobs.push({
            seed,
            count,
            seat,
            configuration: c.name as Job["configuration"],
          });
  const rng = random(1240099);
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  const plan = {
    status: "frozen",
    smoke,
    timeMs: smoke ? 1 : 200,
    workers: smoke ? 2 : 6,
    snapshot,
    replays: join(directory, `${stem}.replays`),
    probeSha256: hashes[join(snapshot, "probe.wasm")],
    configurations,
    baseline,
    jobs,
    hashes,
    primaryMetric:
      "For each configuration average normalized rank (count-rank)/(count-1) within each player count, then average2/3/4/5 equally. Baseline symmetry reference50%, not a measured head-to-head win rate.",
    limitations: [
      "Small pilot: two independent base seeds, all seats; descriptive only, no confirmatory confidence interval.",
      "Both sides200ms, next-epoch horizon, no models. Not a2s strength conclusion.",
      "Two candidates selected as predeclared literature ablations, not by step255 action or intermediate ranks.",
      "All planned games run; no outcome-based stopping, replacement seeds or post-hoc sample extension.",
    ],
  };
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
  const planSha256 = sha(await readFile(planPath));
  const results: any[] = [],
    active = new Map<string, unknown>(),
    workers: Worker[] = [];
  let next = 0,
    failure: unknown,
    saving = Promise.resolve();
  const summary = () =>
    configurations.map((c) => {
      const r = results.filter((r) => r.configuration === c.name);
      const byCount = [2, 3, 4, 5].map((count) => {
        const rows = r.filter((r) => r.count === count);
        return {
          count,
          games: rows.length,
          meanRank: rows.length
            ? rows.reduce((a, r) => a + r.rank, 0) / rows.length
            : null,
          rankingScore: rows.length
            ? rows.reduce((a, r) => a + r.rankingScore, 0) / rows.length
            : null,
          first: rows.filter((r) => r.rank === 1).length,
        };
      });
      return {
        configuration: c.name,
        games: r.length,
        rankingScore: byCount.every((r) => r.games)
          ? byCount.reduce((n, r) => n + r.rankingScore!, 0) / 4
          : null,
        byCount,
      };
    });
  const save = (status: string) => {
    const data =
      JSON.stringify(
        {
          status,
          planPath,
          planSha256,
          completed: results.length,
          total: jobs.length,
          active: [...active.values()],
          summary: summary(),
          results,
        },
        null,
        2,
      ) + "\n";
    saving = saving.then(async () => {
      await writeFile(resultsPath + ".tmp", data);
      await rename(resultsPath + ".tmp", resultsPath);
    });
    return saving;
  };
  await save("running");
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(plan.workers, jobs.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(
              join(snapshot, "scripts/benchmark-ra-study-match.ts"),
              { workerData: { planPath, planSha256 } },
            );
            workers.push(worker);
            worker.on("error", reject);
            worker.on("message", (m) => {
              if (m.error) {
                reject(Error(m.error));
                return;
              }
              if (m.progress) {
                active.set(key(m.progress.job), m.progress);
                void save("running");
                return;
              }
              if (m.done) {
                results.push(m.done);
                active.delete(key(m.done));
                console.log(
                  JSON.stringify({
                    completed: results.length,
                    total: jobs.length,
                    configuration: m.done.configuration,
                    count: m.done.count,
                    seat: m.done.seat,
                    rank: m.done.rank,
                  }),
                );
                void save("running");
              }
              if (m.ready || m.done) {
                if (next < jobs.length) {
                  const job = jobs[next++];
                  active.set(key(job), { job, steps: 0 });
                  worker.postMessage(job);
                } else {
                  void worker.terminate();
                  resolve();
                }
              }
            });
          }),
      ),
    );
  } catch (e) {
    failure = e;
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    active.clear();
    await save(failure ? "failed" : "complete");
  }
  if (failure) throw failure;
  assert.equal(results.length, jobs.length);
  assert.equal(new Set(results.map(key)).size, jobs.length);
  for (const [path, hash] of Object.entries(hashes))
    assert.equal(sha(await readFile(path)), hash, path);
  console.log(JSON.stringify({ status: "complete", summary: summary() }));
}
