import type { RolloutModel } from "../src/game/ai/rollout.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import type { ValueModel } from "../src/game/ai/value.ts";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as createFrozen5 } from "../src/game/ai/wasm-frozen-uct5.ts";
import { newGame, advance, simulate, ranking } from "../src/game/engine.ts";
import { candidateActions, policyAction } from "../src/game/ai/policy.ts";
import type { State } from "../src/game/types.ts";
type Variant = "uct" | "sh" | "dpw";
type Mode = "fixed" | "time";
type Job = {
  variant: Variant;
  mode: Mode;
  count: number;
  seed: number;
  seat: number;
};
type Config = {
  engine: "current" | "frozen5";
  reward: "relative" | "future-rank";
  opponentVariant: Variant;
  samples: number;
  timeMs: number;
  replayDir?: string;
  opponentFixed?: boolean;
  valueModel?: ValueModel;
  rolloutModel?: RolloutModel;
};
const cliArgs = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  cliArgs.set(process.argv[i], process.argv[i + 1]);
const engine = (
  isMainThread ? (cliArgs.get("--engine") ?? "current") : workerData.engine
) as Config["engine"];
if (!["current", "frozen5"].includes(engine)) throw new Error("Invalid engine");
const manifestUrl = new URL(
  engine === "frozen5"
    ? "../artifacts/frozen-uct5/wasm-build.json"
    : "../native/wasm-build.json",
  import.meta.url,
);
const build = JSON.parse(await readFile(manifestUrl, "utf8"));
const bytes = await readFile(
  new URL(
    engine === "frozen5"
      ? "../artifacts/frozen-uct5/ra-ai.wasm"
      : "../src/game/ai/ra-ai.wasm",
    import.meta.url,
  ),
);
const source = await readFile(
  new URL(
    engine === "frozen5"
      ? "../artifacts/frozen-uct5/ra_ai.cpp"
      : "../native/ra_ai.cpp",
    import.meta.url,
  ),
);
if (
  createHash("sha256").update(bytes).digest("hex") !== build.wasmSha256 ||
  createHash("sha256").update(source).digest("hex") !== build.sourceSha256
)
  throw new Error("Build hash mismatch");
const ai = await (engine === "frozen5" ? createFrozen5 : createWasmAi)(bytes);
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
function play(job: Job, config: Config) {
  let s = newGame({
    count: job.count,
    seed: job.seed,
    humans: 0,
    difficulty: "hard",
  });
  const stats = { candidate: blank(), opponent: blank() };
  const recording = config.replayDir ? recorder(s.config) : undefined;
  while (s.phase !== "over" && s.steps < 1600) {
    const candidate = s.current === job.seat,
      t = performance.now();
    const r = ai.search(s, {
      variant: candidate ? job.variant : config.opponentVariant,
      ...(candidate && config.reward !== "relative"
        ? { reward: config.reward }
        : {}),
      horizon: "epoch",
      samples: config.samples,
      ...(candidate && config.rolloutModel
        ? { rolloutModel: config.rolloutModel }
        : {}),
      ...(candidate && config.valueModel
        ? { valueModel: config.valueModel }
        : {}),
      ...(job.mode === "time" && (candidate || !config.opponentFixed)
        ? { timeMs: config.timeMs }
        : {}),
    });
    const elapsed = performance.now() - t,
      row = candidate ? stats.candidate : stats.opponent;
    row.decisions++;
    row.ms += elapsed;
    row.maxMs = Math.max(row.maxMs, elapsed);
    if (r.samples) {
      row.searched++;
      row.searchMs += elapsed;
      if (job.mode === "time" && (candidate || !config.opponentFixed)) {
        row.overshootMs += Math.max(0, elapsed - config.timeMs);
        if (elapsed > config.timeMs + 10) row.overrunCalls++;
      }
    }
    for (const key of [
      "samples",
      "transitions",
      "nodes",
      "outcomeReuses",
      "truncated",
    ] as const)
      row[key] += r[key];
    row.depth = Math.max(row.depth, r.depth);
    row.maxOutcomeBranches = Math.max(
      row.maxOutcomeBranches,
      r.maxOutcomeBranches,
    );
    recording?.record(s, r, elapsed);
    s = advance(s, r.action);
  }
  if (s.phase !== "over" || s.history.length !== 3)
    throw new Error(`Unfinished ${JSON.stringify(job)}`);
  return {
    ...job,
    trace: recording?.finish(s, {
      job,
      samples: config.samples,
      timeMs: config.timeMs,
      opponentFixed: Boolean(config.opponentFixed),
      engine: config.engine,
      reward: config.reward,
      opponentVariant: config.opponentVariant,
      kind: "new recorded game; previous unrecorded timed games cannot be reconstructed exactly",
    }),
    rank: ranking(s).findIndex((p) => p.player === job.seat) + 1,
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
  parentPort!.on("message", async (job: Job) => {
    try {
      const { trace, ...row } = play(job, workerData);
      const replayPath = trace
        ? `${workerData.replayDir}/${job.variant}-${job.mode}-${job.count}p-${job.seed}-seat${job.seat}.json`
        : undefined;
      if (trace && replayPath) {
        trace.audit.metadata.build = build;
        trace.audit.metadata.modelSha256 = workerData.valueModel
          ? createHash("sha256")
              .update(JSON.stringify(workerData.valueModel))
              .digest("hex")
          : null;
        trace.audit.metadata.rolloutModelSha256 = workerData.rolloutModel
          ? createHash("sha256")
              .update(JSON.stringify(workerData.rolloutModel))
              .digest("hex")
          : null;
        await saveTrace(replayPath, trace);
      }
      parentPort!.postMessage({ row: { ...row, replayPath } });
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const args = cliArgs;
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(args.get(name) ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const modelPath = args.get("--model");
  const modelText = modelPath ? await readFile(modelPath, "utf8") : undefined;
  const rolloutPath = args.get("--rollout-model");
  const rolloutText = rolloutPath
    ? await readFile(rolloutPath, "utf8")
    : undefined;
  const reward = (args.get("--reward") ?? "relative") as Config["reward"];
  const opponentVariant = (args.get("--opponent-variant") ?? "uct") as Variant;
  if (
    !["relative", "future-rank"].includes(reward) ||
    !["uct", "sh", "dpw"].includes(opponentVariant) ||
    (engine === "frozen5" && reward !== "relative")
  )
    throw new Error("Invalid reward/opponent/engine combination");
  const config = {
    engine,
    reward,
    opponentVariant,
    ...(rolloutText
      ? { rolloutModel: JSON.parse(rolloutText) as RolloutModel }
      : {}),
    replayDir:
      args.get("--replay-dir") ??
      `${args.get("--out") ?? "artifacts/ai-tree-validation.json"}.replays`,
    ...(modelText ? { valueModel: JSON.parse(modelText) as ValueModel } : {}),
    samples: integer("--samples", 32, 512),
    timeMs: integer("--time-ms", 200, 1000),
    ...(args.get("--opponent-fixed") === "yes" ? { opponentFixed: true } : {}),
  };
  const seeds = integer("--seeds", 6, 100),
    start = integer("--start", 14001, 1_000_000_000),
    workers = integer("--jobs", 3, 8);
  const variants = (args.get("--variants") ?? "sh,dpw").split(",") as Variant[],
    modes = (args.get("--modes") ?? "fixed,time").split(",") as Mode[];
  const counts = (args.get("--counts") ?? "2,3,4,5").split(",").map(Number);
  if (
    !variants.length ||
    variants.some((v) => !["uct", "sh", "dpw"].includes(v)) ||
    new Set(variants).size !== variants.length ||
    !modes.length ||
    modes.some((m) => !["fixed", "time"].includes(m)) ||
    new Set(modes).size !== modes.length ||
    !counts.length ||
    counts.some((n) => ![2, 3, 4, 5].includes(n)) ||
    new Set(counts).size !== counts.length
  )
    throw new Error("Invalid suite");
  const output = args.get("--out") ?? "artifacts/ai-tree-validation.json";
  const costSource = args.get("--cost-source") ?? null;
  const jobs: Job[] = [];
  // Interleave experimental groups; no group gets only the first/last CPU load.
  for (let n = 0; n < seeds; n++)
    for (const count of counts)
      for (let seat = 0; seat < count; seat++)
        for (const variant of variants)
          for (const mode of modes)
            jobs.push({ variant, mode, count, seed: start + n, seat });
  const manifest = build;
  const identity = {
    config,
    rolloutModelSha256: rolloutText
      ? createHash("sha256").update(rolloutText).digest("hex")
      : null,
    modelSha256: modelText
      ? createHash("sha256").update(modelText).digest("hex")
      : null,
    seeds,
    start,
    counts,
    variants,
    modes,
    costSource,
    sourceSha256: manifest.sourceSha256,
    wasmSha256: manifest.wasmSha256,
  };
  let games: ReturnType<typeof play>[] = [],
    previousSeconds = 0;
  let costs: {
    variant: string;
    position: number;
    ms: number;
    samples: number;
    transitions: number;
    nodes: number;
    depth: number;
    outcomeReuses: number;
    maxOutcomeBranches: number;
  }[] = [];
  let existing: any;
  try {
    existing = JSON.parse(await readFile(output, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing) {
    if (
      args.get("--resume") !== "yes" ||
      JSON.stringify(existing.identity) !== JSON.stringify(identity)
    )
      throw new Error(
        "Existing result; use --resume yes with identical suite and binary, or choose a new output",
      );
    games = existing.games;
    costs = existing.costs;
    previousSeconds = existing.seconds;
  }
  const started = performance.now();
  if (!existing && costSource) {
    const source = JSON.parse(await readFile(costSource, "utf8"));
    if (
      source.identity.sourceSha256 !== identity.sourceSha256 ||
      source.identity.wasmSha256 !== identity.wasmSha256 ||
      source.identity.config.samples !== config.samples ||
      JSON.stringify(source.identity.counts) !== JSON.stringify(counts)
    )
      throw new Error(
        "Serial cost source must use identical binary, sample budget and player counts",
      );
    costs = source.costs;
  } else if (!existing && args.get("--costs") !== "off") {
    const positions: State[] = [];
    for (const count of counts) {
      let s = newGame({
        count,
        seed: 9600 + count,
        humans: 0,
        difficulty: "normal",
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
    const algorithms = ["uct", "sh", "dpw"] as const;
    for (const variant of algorithms)
      ai.search(positions[0], { variant, samples: 4 });
    for (let i = 0; i < positions.length; i++)
      for (let n = 0; n < algorithms.length; n++) {
        const variant = algorithms[(i + n) % algorithms.length],
          t = performance.now();
        const r = ai.search(positions[i], { variant, samples: config.samples });
        costs.push({
          variant,
          position: i,
          ms: performance.now() - t,
          samples: r.samples,
          transitions: r.transitions,
          nodes: r.nodes,
          depth: r.depth,
          outcomeReuses: r.outcomeReuses,
          maxOutcomeBranches: r.maxOutcomeBranches,
        });
      }
  }
  function report(status: string) {
    return {
      status,
      evaluation: {
        primary:
          "Mean rank by player count and normalized rank score (players-rank)/(players-1); aggregate player counts equally",
        secondary: ["first-place count", "score margin"],
        referenceNormalizedRankScore: 0.5,
      },
      identity,
      workers,
      plannedGames: jobs.length,
      finishedGames: games.length,
      seconds: previousSeconds + (performance.now() - started) / 1000,
      costSummary: ["uct", "sh", "dpw"].map((variant) => {
        const rows = costs.filter((r) => r.variant === variant),
          times = rows.map((r) => r.ms).sort((a, b) => a - b);
        return {
          variant,
          positions: rows.length,
          totalMs: times.reduce((a, b) => a + b, 0),
          medianMs: times[Math.floor(times.length / 2)],
          p95Ms: times[Math.floor(times.length * 0.95)],
          nodes: rows.reduce((n, r) => n + r.nodes, 0),
          meanDepth: rows.reduce((n, r) => n + r.depth, 0) / rows.length,
          outcomeReuses: rows.reduce((n, r) => n + r.outcomeReuses, 0),
          maxOutcomeBranches: Math.max(
            0,
            ...rows.map((r) => r.maxOutcomeBranches),
          ),
        };
      }),
      summary: variants.flatMap((variant) =>
        modes.flatMap((mode) =>
          counts.map((count) => {
            const rows = games.filter(
                (g) =>
                  g.variant === variant && g.mode === mode && g.count === count,
              ),
              n = rows.length;
            return {
              variant,
              mode,
              count,
              games: n,
              referenceMeanRank: (count + 1) / 2,
              normalizedRankScore: n
                ? rows.reduce((v, g) => v + (count - g.rank) / (count - 1), 0) /
                  n
                : null,
              rankDistribution: Array.from(
                { length: count },
                (_, i) => rows.filter((g) => g.rank === i + 1).length,
              ),
              wins: rows.filter((g) => g.rank === 1).length,
              referenceWins: n / count,
              meanRank: n ? rows.reduce((v, g) => v + g.rank, 0) / n : null,
              meanMargin: n ? rows.reduce((v, g) => v + g.margin, 0) / n : null,
            };
          }),
        ),
      ),
      costs,
      games: [...games].sort(
        (a, b) =>
          a.seed - b.seed ||
          a.count - b.count ||
          a.seat - b.seat ||
          a.variant.localeCompare(b.variant) ||
          a.mode.localeCompare(b.mode),
      ),
      caveat: `Fixed mode: ${config.samples} simulations per root candidate for everyone. Time mode: candidate ${config.timeMs}ms, opponents ${config.opponentFixed ? "fixed rootCandidates × samples" : config.timeMs + "ms"} soft compute deadlines, finish a current rollout and cover all root actions; SH uses the published Anytime schedule. Candidate reward: ${config.reward}; opponents: ${config.opponentVariant} / relative reward. Parallel workers affect elapsed time and simulation counts; only the separately collected serial cost data are latency benchmarks. Seat rotations share seeds, so games are not independent trials.`,
    };
  }
  let saving = Promise.resolve();
  const save = (status: string) => {
    const data = JSON.stringify(report(status), null, 2) + "\n";
    saving = saving.then(async () => {
      await writeFile(output + ".tmp", data);
      await rename(output + ".tmp", output);
    });
    return saving;
  };
  await save("running");
  console.log(
    JSON.stringify({
      plannedGames: jobs.length,
      costSummary: report("running").costSummary,
    }),
  );
  const key = (g: Job) =>
    `${g.variant}/${g.mode}/${g.count}/${g.seed}/${g.seat}`;
  const seen = new Set(games.map(key)),
    remaining = jobs.filter((g) => !seen.has(key(g)));
  let next = 0,
    stopping = false;
  const live: Worker[] = [];
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(workers, remaining.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), {
              workerData: config,
            });
            live.push(w);
            let done = false;
            w.on("error", reject);
            w.on("exit", (code) => {
              if (!done && !stopping)
                reject(new Error(`Worker exited early ${code}`));
            });
            w.on("message", (message) => {
              if (stopping) return;
              if (message.error) {
                reject(new Error(message.error));
                return;
              }
              if (message.row) {
                if (seen.has(key(message.row))) {
                  reject(new Error("Duplicate game"));
                  return;
                }
                seen.add(key(message.row));
                games.push(message.row);
                console.log(
                  JSON.stringify({
                    finished: games.length,
                    total: jobs.length,
                    variant: message.row.variant,
                    mode: message.row.mode,
                    count: message.row.count,
                    seed: message.row.seed,
                    seat: message.row.seat,
                    rank: message.row.rank,
                  }),
                );
                void save("running").catch(reject);
              }
              if (next < remaining.length) w.postMessage(remaining[next++]);
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
    stopping = true;
    await Promise.all(live.map((w) => w.terminate()));
    await save("failed");
    throw error;
  } finally {
    stopping = true;
    await Promise.all(live.map((w) => w.terminate()));
  }
}
