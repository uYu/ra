import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { advance, newGame, ranking, simulate } from "../src/game/engine.ts";
import { candidateActions, policyAction } from "../src/game/ai/policy.ts";
import type { State } from "../src/game/types.ts";

type Job = { count: number; seed: number; seat: number };
type Config = { samples: number; opponentSamples: number };
const bytes = await readFile(
  new URL("../src/game/ai/ra-ai.wasm", import.meta.url),
);
const ai = await createWasmAi(bytes);

function play(job: Job, config: Config) {
  let s = newGame({ ...job, humans: 0, difficulty: "hard" });
  const stats = {
    candidate: {
      ms: 0,
      decisions: 0,
      samples: 0,
      transitions: 0,
      truncated: 0,
      epochAdvances: 0,
    },
    opponent: {
      ms: 0,
      decisions: 0,
      samples: 0,
      transitions: 0,
      truncated: 0,
      epochAdvances: 0,
    },
  };
  while (s.phase !== "over" && s.steps < 1600) {
    const candidate = s.current === job.seat;
    const started = performance.now();
    const r = ai.search(s, {
      samples: candidate ? config.samples : config.opponentSamples,
      horizon: candidate ? "next-epoch" : "epoch",
    });
    const row = candidate ? stats.candidate : stats.opponent;
    row.ms += performance.now() - started;
    row.decisions++;
    for (const key of [
      "samples",
      "transitions",
      "truncated",
      "epochAdvances",
    ] as const)
      row[key] += r[key];
    s = advance(s, r.action);
  }
  if (s.phase !== "over") throw new Error(`Unfinished ${JSON.stringify(job)}`);
  return {
    ...job,
    rank: ranking(s).findIndex((r) => r.player === job.seat) + 1,
    score: s.players[job.seat].score,
    margin:
      s.players[job.seat].score -
      Math.max(
        ...s.players.filter((_, i) => i !== job.seat).map((p) => p.score),
      ),
    steps: s.steps,
    stats,
  };
}

if (!isMainThread) {
  parentPort!.on("message", (job: Job) => {
    try {
      parentPort!.postMessage({ row: play(job, workerData) });
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2)
    args.set(process.argv[i], process.argv[i + 1]);
  const split = args.get("--split") ?? "validation";
  if (!["pilot", "validation"].includes(split))
    throw new Error("--split must be pilot or validation");
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(args.get(name) ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const seeds = integer("--seeds", split === "pilot" ? 2 : 6, 100);
  const start = integer(
    "--start",
    split === "pilot" ? 11001 : 12001,
    1_000_000_000,
  );
  if (
    (split === "pilot" && (start < 11001 || start + seeds > 12001)) ||
    (split === "validation" && start < 12001)
  )
    throw new Error(
      "Pilot seeds must stay in 11001–12000; validation seeds start at 12001",
    );
  const counts = (args.get("--counts") ?? "2,3,4,5").split(",").map(Number);
  if (
    !counts.length ||
    new Set(counts).size !== counts.length ||
    counts.some((n) => ![2, 3, 4, 5].includes(n))
  )
    throw new Error("Invalid --counts");
  const config = {
    samples: integer("--samples", 32, 512),
    opponentSamples: integer("--opponent-samples", 32, 512),
  };
  const workers = integer("--jobs", 3, 8);
  const measureCosts = args.get("--costs") !== "off";
  const output = args.get("--out") ?? `artifacts/ai-next-epoch-${split}.json`;
  const jobs: Job[] = [];
  // Fixed order; each seed covers every player count and candidate seat.
  for (let n = 0; n < seeds; n++)
    for (const count of counts)
      for (let seat = 0; seat < count; seat++)
        jobs.push({ count, seed: start + n, seat });
  const games: ReturnType<typeof play>[] = [];
  const started = performance.now();
  const manifest = JSON.parse(
    await readFile(
      new URL("../native/wasm-build.json", import.meta.url),
      "utf8",
    ),
  );

  // Serial, warmed cost comparison. Tournament workers run concurrently, so
  // their elapsed times are diagnostic only, not comparable latency benchmarks.
  const costs: {
    variant: string;
    position: number;
    ms: number;
    samples: number;
    transitions: number;
    truncated: number;
  }[] = [];
  const positions: State[] = [];
  for (const count of measureCosts ? counts : []) {
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
  const variants = [
    { variant: "epoch32", samples: 32, horizon: "epoch" },
    { variant: "next32", samples: 32, horizon: "next-epoch" },
    { variant: "epoch64", samples: 64, horizon: "epoch" },
  ] as const;
  if (measureCosts)
    for (const v of variants)
      ai.search(positions[0], { horizon: v.horizon, samples: 4 });
  for (let i = 0; i < positions.length; i++)
    for (const offset of [0, 1, 2]) {
      const v = variants[(i + offset) % variants.length],
        t = performance.now();
      const r = ai.search(positions[i], {
        horizon: v.horizon,
        samples: v.samples,
      });
      costs.push({
        variant: v.variant,
        position: i,
        ms: performance.now() - t,
        samples: r.samples,
        transitions: r.transitions,
        truncated: r.truncated,
      });
    }
  const costSummary = (measureCosts ? variants : []).map(({ variant }) => {
    const rows = costs.filter((r) => r.variant === variant),
      times = rows.map((r) => r.ms).sort((a, b) => a - b);
    return {
      variant,
      positions: rows.length,
      totalMs: times.reduce((a, b) => a + b, 0),
      medianMs: times[Math.floor(times.length / 2)],
      p95Ms: times[Math.floor(times.length * 0.95)],
      simulations: rows.reduce((v, r) => v + r.samples, 0),
      truncated: rows.reduce((v, r) => v + r.truncated, 0),
    };
  });
  console.log(JSON.stringify({ costSummary }));
  function report(status: string) {
    return {
      status,
      evaluation: {
        primary:
          "Mean rank by player count and normalized rank score; aggregate player counts equally",
        secondary: ["first-place count", "score margin"],
        referenceNormalizedRankScore: 0.5,
      },
      split,
      candidate: { horizon: "next-epoch", samples: config.samples },
      opponent: { horizon: "epoch", samples: config.opponentSamples },
      seedStart: start,
      seeds,
      counts,
      allSeats: true,
      plannedGames: jobs.length,
      finishedGames: games.length,
      workers,
      sourceSha256: manifest.sourceSha256,
      wasmSha256: manifest.wasmSha256,
      summary: counts.map((count) => {
        const rows = games.filter((g) => g.count === count),
          n = rows.length;
        return {
          count,
          games: n,
          referenceMeanRank: (count + 1) / 2,
          normalizedRankScore: n
            ? rows.reduce((v, g) => v + (count - g.rank) / (count - 1), 0) / n
            : null,
          rankDistribution: Array.from(
            { length: count },
            (_, i) => rows.filter((g) => g.rank === i + 1).length,
          ),
          wins: rows.filter((g) => g.rank === 1).length,
          winRate: n ? rows.filter((g) => g.rank === 1).length / n : null,
          equalStrengthReference: 1 / count,
          meanRank: n ? rows.reduce((v, r) => v + r.rank, 0) / n : null,
          meanMargin: n ? rows.reduce((v, r) => v + r.margin, 0) / n : null,
        };
      }),
      bySeed: Array.from({ length: seeds }, (_, n) => {
        const rows = games.filter((g) => g.seed === start + n);
        return {
          seed: start + n,
          games: rows.length,
          wins: rows.filter((g) => g.rank === 1).length,
        };
      }),
      costSummary,
      costs,
      games: [...games].sort(
        (a, b) => a.seed - b.seed || a.count - b.count || a.seat - b.seat,
      ),
      seconds: (performance.now() - started) / 1000,
      caveat:
        "Fixed simulation budgets, not equal wall time. Only serial cost measurements are latency comparisons. Seat rotations share a seed; do not treat them as independent statistical trials. Pilot and validation seeds are disjoint.",
    };
  }
  // Serialize checkpoints; interruption still leaves the completed games readable.
  let saving = Promise.resolve();
  function save(status: string) {
    const data = JSON.stringify(report(status), null, 2) + "\n";
    saving = saving.then(async () => {
      await writeFile(output + ".tmp", data);
      await rename(output + ".tmp", output);
    });
    return saving;
  }
  await save("running");
  let next = 0;
  const live: Worker[] = [];
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(workers, jobs.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), {
              workerData: config,
            });
            live.push(w);
            let done = false;
            w.on("error", reject);
            w.on("exit", (code) => {
              if (!done) reject(new Error(`Worker exited early (${code})`));
            });
            w.on("message", (message) => {
              if (message.error) {
                reject(new Error(message.error));
                return;
              }
              if (message.row) {
                games.push(message.row);
                console.log(
                  JSON.stringify({
                    finished: games.length,
                    total: jobs.length,
                    ...message.row,
                  }),
                );
                void save("running").catch(reject);
              }
              if (next < jobs.length) w.postMessage(jobs[next++]);
              else {
                done = true;
                void w.terminate();
                resolve();
              }
            });
          }),
      ),
    );
    await save("complete");
    console.log(JSON.stringify(report("complete").summary, null, 2));
  } catch (error) {
    await save("failed");
    throw error;
  } finally {
    await Promise.all(live.map((w) => w.terminate()));
  }
}
