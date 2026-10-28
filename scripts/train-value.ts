import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { createWasmAi } from "../src/game/ai/wasm-frozen-uct3.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { futureValues } from "../src/game/ai/evaluation.ts";
import {
  VALUE_INPUTS,
  valueFeatures,
  type ValueModel,
} from "../src/game/ai/value.ts";
import { random } from "../src/game/data.ts";
type Row = {
  x: number[];
  y: number;
  baseline: number;
  epoch: number;
  player: number;
};
type Game = { seed: number; count: number; split: string; rows: Row[] };
if (!isMainThread) {
  const ai = await createWasmAi(
    await readFile(
      new URL("../artifacts/frozen-uct3/ra-ai.wasm", import.meta.url),
    ),
  );
  parentPort!.on(
    "message",
    ({
      seed,
      count,
      split,
    }: {
      seed: number;
      count: number;
      split: string;
    }) => {
      try {
        let s = newGame({ count, seed, humans: 0, difficulty: "hard" });
        const snapshots: { rows: Row[]; scores: number[] }[] = [];
        while (s.phase !== "over" && s.steps < 1600) {
          if (s.phase === "epoch")
            snapshots.push({
              scores: s.players.map((p) => p.score),
              rows: s.players.map((_, i) => ({
                x: valueFeatures(s, i),
                y: 0,
                baseline: futureValues(s)[i],
                epoch: s.epoch,
                player: i,
              })),
            });
          // Mix the existing rollout policy and low-budget UCT, frozen before training.
          const action =
            s.phase === "epoch"
              ? { type: "next" as const }
              : seed % 5 === 0
                ? ai.search(s, { samples: 2 }).action
                : ai.policy(s);
          s = advance(s, action);
        }
        if (s.phase !== "over") throw new Error("Incomplete training game");
        const rows = snapshots.flatMap((z) =>
          z.rows.map((r) => ({
            ...r,
            y: s.players[r.player].score - z.scores[r.player],
          })),
        );
        parentPort!.postMessage({ game: { seed, count, split, rows } });
      } catch (e) {
        parentPort!.postMessage({ error: String(e) });
      }
    },
  );
  parentPort!.postMessage({ ready: true });
} else {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2)
    args.set(process.argv[i], process.argv[i + 1]);
  const trainGames = Number(args.get("--train") ?? 2000),
    devGames = Number(args.get("--dev") ?? 400),
    workers = Number(args.get("--jobs") ?? 2);
  const datasetPath = "artifacts/ai-value-dataset.json";
  let games: Game[] = [];
  try {
    games = JSON.parse(await readFile(datasetPath, "utf8")).games;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const jobs = [
    ...Array.from({ length: trainGames }, (_, i) => ({
      seed: 200001 + i,
      count: 2 + (i % 4),
      split: "train",
    })),
    ...Array.from({ length: devGames }, (_, i) => ({
      seed: 300001 + i,
      count: 2 + (i % 4),
      split: "dev",
    })),
  ];
  const seen = new Set(games.map((g) => g.seed));
  const todo = jobs.filter((g) => !seen.has(g.seed));
  let next = 0,
    saving = Promise.resolve();
  const save = () => {
    const data = JSON.stringify({
      description:
        "Game-level split; frozen policy/UCT2 self-play; targets final score minus score banked at epoch boundary. Private scores only used for labels.",
      games,
    });
    saving = saving.then(async () => {
      await writeFile(datasetPath + ".tmp", data);
      await rename(datasetPath + ".tmp", datasetPath);
    });
    return saving;
  };
  const live: Worker[] = [];
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(workers, todo.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: {} });
            live.push(w);
            w.on("error", reject);
            w.on("message", (m) => {
              if (m.error) {
                reject(new Error(m.error));
                return;
              }
              if (m.game) {
                games.push(m.game);
                if (games.length % 100 === 0) {
                  console.log(
                    JSON.stringify({ games: games.length, total: jobs.length }),
                  );
                  void save().catch(reject);
                }
              }
              if (next < todo.length) w.postMessage(todo[next++]);
              else {
                void w.terminate();
                resolve();
              }
            });
          }),
      ),
    );
  } finally {
    await Promise.all(live.map((w) => w.terminate()));
    await save();
  }
  games.sort((a, b) => a.seed - b.seed);
  const train = games.filter((g) => g.split === "train").flatMap((g) => g.rows),
    dev = games.filter((g) => g.split === "dev").flatMap((g) => g.rows);
  const d = VALUE_INPUTS,
    h = 24,
    n = h * (d + 2) + 1;
  const rng = random(625004),
    w = Array.from({ length: n }, () => (rng() - 0.5) * 0.15),
    mom = new Float64Array(n),
    vel = new Float64Array(n);
  const model: ValueModel = { version: 1, inputs: d, hidden: h, weights: w };
  let best = Infinity,
    bestW = [...w],
    step = 0;
  const prediction = (x: number[]) => {
    const a = Array.from({ length: h }, (_, j) =>
      Math.tanh(
        w[j * (d + 1) + d] +
          x.reduce((v, x, k) => v + w[j * (d + 1) + k] * x, 0),
      ),
    );
    return {
      a,
      y: w[n - 1] + a.reduce((v, z, j) => v + w[h * (d + 1) + j] * z, 0),
    };
  };
  const mse = (rows: Row[], baseline = false) =>
    rows.reduce(
      (v, r) =>
        v + (baseline ? r.baseline - r.y : prediction(r.x).y * 40 - r.y) ** 2,
      0,
    ) / rows.length;
  const centeredMse = (baseline = false) => {
    let total = 0,
      n = 0;
    for (const game of games.filter((g) => g.split === "dev"))
      for (const epoch of [1, 2]) {
        const rows = game.rows.filter((r) => r.epoch === epoch);
        const errors = rows.map(
          (r) => (baseline ? r.baseline : prediction(r.x).y * 40) - r.y,
        );
        const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
        for (const e of errors) {
          total += (e - mean) ** 2;
          n++;
        }
      }
    return total / n;
  };
  const history = [];
  for (let epoch = 0; epoch < 140; epoch++) {
    const indices = Array.from({ length: train.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let start = 0; start < indices.length; start += 64) {
      const grad = new Float64Array(n),
        batch = indices.slice(start, start + 64);
      for (const i of batch) {
        const r = train[i],
          { a, y } = prediction(r.x),
          err = (2 * (y - r.y / 40)) / batch.length;
        grad[n - 1] += err;
        for (let j = 0; j < h; j++) {
          grad[h * (d + 1) + j] += err * a[j];
          const back = err * w[h * (d + 1) + j] * (1 - a[j] * a[j]);
          grad[j * (d + 1) + d] += back;
          for (let k = 0; k < d; k++) grad[j * (d + 1) + k] += back * r.x[k];
        }
      }
      step++;
      const b1 = 1 - 0.9 ** step,
        b2 = 1 - 0.999 ** step;
      for (let k = 0; k < n; k++) {
        const g = grad[k] + 0.0001 * w[k];
        mom[k] = 0.9 * mom[k] + 0.1 * g;
        vel[k] = 0.999 * vel[k] + 0.001 * g * g;
        w[k] -= (0.001 * (mom[k] / b1)) / (Math.sqrt(vel[k] / b2) + 1e-8);
      }
    }
    const loss = centeredMse();
    history.push({
      epoch,
      trainMse: mse(train),
      devMse: mse(dev),
      devCenteredMse: loss,
    });
    if (loss < best) {
      best = loss;
      bestW = [...w];
    }
    if (epoch % 10 === 0) console.log(JSON.stringify(history.at(-1)));
  }
  for (let i = 0; i < n; i++) w[i] = bestW[i];
  model.weights = bestW;
  await writeFile("artifacts/ai-value-model.json", JSON.stringify(model));
  const sha = (bytes: string | Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const frozenManifest = JSON.parse(
    await readFile("artifacts/frozen-uct3/wasm-build.json", "utf8"),
  );
  const metadata = {
    frozenSourceSha256: frozenManifest.sourceSha256,
    frozenWasmSha256: frozenManifest.wasmSha256,
    datasetSha256: sha(await readFile(datasetPath)),
    modelSha256: sha(JSON.stringify(model)),
    trainSeedRange: [200001, 200000 + trainGames],
    devSeedRange: [300001, 300000 + devGames],
    trainGames: games.filter((g) => g.split === "train").length,
    devGames: games.filter((g) => g.split === "dev").length,
    trainRows: train.length,
    devRows: dev.length,
    features: d,
    hidden: h,
    baselineDevMse: mse(dev, true),
    bestDevMse: mse(dev),
    baselineDevCenteredMse: centeredMse(true),
    bestDevCenteredMse: best,
    selectedEpoch: history.reduce((a, b) =>
      a.devCenteredMse < b.devCenteredMse ? a : b,
    ).epoch,
    history,
    training:
      "Adam, MSE / 40², 140 epochs, batch64, lr0.001, L2=0.0001; choose checkpoint using centered MSE on dev games only; init/shuffle seed625004",
  };
  await writeFile(
    "artifacts/ai-value-training.json",
    JSON.stringify(metadata, null, 2),
  );
  console.log(JSON.stringify(metadata));
}
