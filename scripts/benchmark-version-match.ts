import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, advance, ranking } from "../src/game/engine.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";

type Job = {
  variant: "uct";
  mode: "time";
  seed: number;
  count: number;
  seat: number;
};
const planPath = isMainThread ? process.argv[2] : workerData.planPath;
assert.ok(planPath, "Usage: benchmark-version-match.ts PLAN.json");
const planBytes = await readFile(planPath);
const plan = JSON.parse(planBytes.toString());
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const planSha256 = sha(planBytes);
assert.ok(plan.design.seeds >= 1 && plan.design.seeds <= 100);
assert.ok(plan.design.workers >= 1 && plan.design.workers <= 6);
assert.deepEqual(plan.design.counts, [...new Set(plan.design.counts)].sort());
assert.ok(plan.design.counts.every((n: number) => [2, 3, 4, 5].includes(n)));
assert.ok(Number.isInteger(plan.design.start) && plan.design.start > 0);
assert.equal(plan.candidate.timeMs, plan.opponent.timeMs);
assert.ok(
  Number.isInteger(plan.candidate.timeMs) &&
    plan.candidate.timeMs >= 1 &&
    plan.candidate.timeMs <= 2000,
);
for (const [file, hash] of Object.entries(plan.hashes))
  assert.equal(sha(await readFile(file)), hash, file);
const load = async (side: "candidate" | "opponent") => {
  const spec = plan[side];
  const build = JSON.parse(
    await readFile(resolve(spec.root, "native/wasm-build.json"), "utf8"),
  );
  assert.equal(build.abi, 6);
  const bytes = await readFile(resolve(spec.root, "src/game/ai/ra-ai.wasm"));
  assert.equal(sha(bytes), spec.wasmSha256);
  assert.equal(build.wasmSha256, spec.wasmSha256);
  assert.equal(
    sha(await readFile(resolve(spec.root, "native/ra_ai.cpp"))),
    spec.sourceSha256,
  );
  assert.equal(build.sourceSha256, spec.sourceSha256);
  return { ai: await createWasmAi(bytes), build };
};
const candidate = await load("candidate"),
  opponent = await load("opponent");
const blank = () => ({
  decisions: 0,
  searched: 0,
  ms: 0,
  searchMs: 0,
  maxMs: 0,
  overshootMs: 0,
  overrunCalls: 0,
  samples: 0,
  transitions: 0,
  nodes: 0,
  depth: 0,
  outcomeReuses: 0,
  maxOutcomeBranches: 0,
  truncated: 0,
});
const key = (j: Job) => `${j.seed}/${j.count}/${j.seat}`;
async function play(job: Job) {
  let state = newGame({
    count: job.count,
    seed: job.seed,
    humans: 0,
    difficulty: "hard",
  });
  const stats = { candidate: blank(), opponent: blank() };
  const recording = recorder(state.config);
  const gameStartedAt = new Date().toISOString();
  let lastProgress = 0;
  const progress = (force = false) => {
    if (!force && Date.now() - lastProgress < 1000) return;
    lastProgress = Date.now();
    parentPort!.postMessage({
      progress: {
        ...job,
        epoch: state.epoch,
        steps: state.steps,
        phase: state.phase,
        currentSeat: state.current,
        thinkingSide: state.current === job.seat ? "candidate" : "opponent",
        gameStartedAt,
        lastProgressAt: new Date().toISOString(),
        stats,
      },
    });
  };
  progress(true);
  while (state.phase !== "over" && state.steps < 1600) {
    const side = state.current === job.seat ? "candidate" : "opponent";
    const backend = side === "candidate" ? candidate.ai : opponent.ai;
    const started = performance.now();
    const report = backend.search(state, {
      variant: "uct",
      horizon: "epoch",
      samples: 32,
      timeMs: plan[side].timeMs,
      reward: "relative",
    });
    const elapsed = performance.now() - started;
    const row = stats[side];
    row.decisions++;
    row.ms += elapsed;
    row.maxMs = Math.max(row.maxMs, elapsed);
    if (report.samples) {
      assert.ok(elapsed >= plan[side].timeMs * 0.95, "Unspent time budget");
      assert.ok(report.samples < 1_000_000, "Search safety cap reached");
      row.searched++;
      row.searchMs += elapsed;
      row.overshootMs += Math.max(0, elapsed - plan[side].timeMs);
      row.overrunCalls += Number(elapsed > plan[side].timeMs + 10);
    }
    for (const field of [
      "samples",
      "transitions",
      "nodes",
      "outcomeReuses",
      "truncated",
    ] as const)
      row[field] += report[field];
    row.depth = Math.max(row.depth, report.depth);
    row.maxOutcomeBranches = Math.max(
      row.maxOutcomeBranches,
      report.maxOutcomeBranches,
    );
    recording.record(state, report, elapsed);
    state = advance(state, report.action);
    progress();
  }
  assert.equal(state.phase, "over");
  assert.equal(state.history.length, 3);
  const trace = recording.finish(state, {
    studyKind: "version-2s",
    job,
    planSha256,
    samples: 32,
    timeMs: plan.candidate.timeMs,
    opponentTimeMs: plan.opponent.timeMs,
    opponentFixed: false,
    engine: "current",
    reward: "relative",
    opponentVariant: "uct",
    build: candidate.build,
    opponentBuild: opponent.build,
    modelSha256: null,
    rolloutModelSha256: null,
  });
  const replayPath = `${plan.output}.replays/uct-time-${job.count}p-${job.seed}-seat${job.seat}.json`;
  await saveTrace(replayPath, trace);
  return {
    ...job,
    rank: ranking(state).findIndex((p) => p.player === job.seat) + 1,
    score: state.players[job.seat].score,
    margin:
      state.players[job.seat].score -
      Math.max(
        ...state.players.filter((_, i) => i !== job.seat).map((p) => p.score),
      ),
    steps: state.steps,
    stats,
    replayPath,
  };
}
if (!isMainThread) {
  parentPort!.on("message", async (job: Job) => {
    try {
      parentPort!.postMessage({ row: await play(job) });
    } catch (error) {
      parentPort!.postMessage({ error: String(error), job });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  try {
    await access(plan.output);
    throw new Error("Result exists; never restart or overwrite a study");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const jobs: Job[] = [];
  for (let i = 0; i < plan.design.seeds; i++)
    for (const count of plan.design.counts)
      for (let seat = 0; seat < count; seat++)
        jobs.push({
          variant: "uct",
          mode: "time",
          seed: plan.design.start + i,
          count,
          seat,
        });
  assert.equal(jobs.length, plan.design.games);
  const identity = {
    config: {
      studyKind: "version-2s",
      engine: "current",
      reward: "relative",
      opponentVariant: "uct",
      horizon: "epoch",
      samples: 32,
      timeMs: plan.candidate.timeMs,
      opponentTimeMs: plan.opponent.timeMs,
      opponentFixed: false,
      candidateLabel: "当前版 2 秒",
      opponentLabel: "原始版 2 秒",
      replayDir: `${plan.output}.replays`,
    },
    planPath,
    planSha256,
    seeds: plan.design.seeds,
    start: plan.design.start,
    counts: plan.design.counts,
    variants: ["uct"],
    modes: ["time"],
    sourceSha256: candidate.build.sourceSha256,
    wasmSha256: candidate.build.wasmSha256,
    opponentSourceSha256: opponent.build.sourceSha256,
    opponentWasmSha256: opponent.build.wasmSha256,
    modelSha256: null,
    rolloutModelSha256: null,
  };
  const games: Awaited<ReturnType<typeof play>>[] = [];
  const active = new Map<number, any>();
  const seen = new Set<string>();
  const live: Worker[] = [];
  const startedAt = new Date().toISOString(),
    started = performance.now();
  let status = "running",
    failure: string | null = null,
    stopping = false,
    next = 0;
  let lastProgressAt = startedAt;
  let saving = Promise.resolve();
  function save() {
    const data =
      JSON.stringify(
        {
          status,
          identity,
          workers: plan.design.workers,
          processId: process.pid,
          plannedGames: jobs.length,
          finishedGames: games.length,
          startedAt,
          lastProgressAt,
          updatedAt: new Date().toISOString(),
          seconds: (performance.now() - started) / 1000,
          failure,
          evaluation: plan.evaluation,
          inProgress: [...active.values()],
          games: [...games].sort(
            (a, b) => a.seed - b.seed || a.count - b.count || a.seat - b.seat,
          ),
          caveat:
            "One current-version seat vs original-version opponents, everyone 2000ms; all seeds/seats predeclared. Parallel load affects throughput; timings compare different encountered positions. No outcome-dependent stopping.",
        },
        null,
        2,
      ) + "\n";
    saving = saving.then(async () => {
      await writeFile(plan.output + ".tmp", data);
      await rename(plan.output + ".tmp", plan.output);
    });
    return saving;
  }
  await mkdir(dirname(plan.output), { recursive: true });
  await save();
  const heartbeat = setInterval(() => {
    void save().catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
  }, 3000);
  let rejectSignal: (e: Error) => void = () => {};
  const signalFailure = new Promise<void>((_, reject) => {
    rejectSignal = reject;
  });
  const stop = () => rejectSignal(new Error("Stopped by process signal"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    JSON.stringify({
      event: "started",
      processId: process.pid,
      plannedGames: jobs.length,
      workers: plan.design.workers,
      planSha256,
    }),
  );
  try {
    await Promise.race([
      signalFailure,
      Promise.all(
        Array.from(
          { length: Math.min(plan.design.workers, jobs.length) },
          (_, workerId) =>
            new Promise<void>((done, reject) => {
              const worker = new Worker(new URL(import.meta.url), {
                workerData: { planPath },
              });
              live.push(worker);
              let finished = false;
              worker.on("error", reject);
              worker.on("exit", (code) => {
                if (!finished && !stopping)
                  reject(new Error(`Worker ${workerId} exited ${code}`));
              });
              worker.on("message", (message) => {
                if (stopping) return;
                if (message.error) {
                  reject(new Error(message.error));
                  return;
                }
                if (message.progress) {
                  active.set(workerId, { ...message.progress, workerId });
                  lastProgressAt = message.progress.lastProgressAt;
                  return;
                }
                if (message.row) {
                  if (seen.has(key(message.row))) {
                    reject(new Error("Duplicate game"));
                    return;
                  }
                  seen.add(key(message.row));
                  games.push(message.row);
                  active.delete(workerId);
                  lastProgressAt = new Date().toISOString();
                  console.log(
                    JSON.stringify({
                      event: "game-finished",
                      finished: games.length,
                      total: jobs.length,
                      ...message.row,
                      stats: undefined,
                    }),
                  );
                  void save().catch(reject);
                }
                if (next < jobs.length) {
                  const job = jobs[next++];
                  active.set(workerId, {
                    ...job,
                    workerId,
                    epoch: 1,
                    steps: 0,
                    phase: "initializing",
                    lastProgressAt: new Date().toISOString(),
                    stats: { candidate: blank(), opponent: blank() },
                  });
                  worker.postMessage(job);
                } else {
                  finished = true;
                  active.delete(workerId);
                  void worker.terminate();
                  done();
                }
              });
            }),
        ),
      ),
    ]);
    assert.equal(games.length, jobs.length);
    status = "complete";
  } catch (error) {
    stopping = true;
    status = "failed";
    failure = String(error);
    process.exitCode = 1;
  } finally {
    stopping = true;
    clearInterval(heartbeat);
    await Promise.all(live.map((w) => w.terminate()));
    await save();
    console.log(
      JSON.stringify({
        event: status,
        finished: games.length,
        planned: jobs.length,
        failure,
      }),
    );
  }
}
