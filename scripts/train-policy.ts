import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm-frozen-uct4.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { candidateActions } from "../src/game/ai/policy.ts";
import { random } from "../src/game/data.ts";
import {
  POLICY_INPUTS,
  policyStateFeatures,
  policyActionFeatures,
  validateRolloutModel,
  type RolloutModel,
} from "../src/game/ai/rollout.ts";
const index = JSON.parse(
  await readFile("artifacts/policy-teacher-index.json", "utf8"),
);
if (index.complete !== 80 || index.jobs.length !== 80)
  throw Error("Need all80 complete teacher games");
const ai = await createWasmAi(
  await readFile("artifacts/frozen-uct4/ra-ai.wasm"),
);
const sha = (b: string | Buffer) =>
    createHash("sha256").update(b).digest("hex"),
  key = (a: unknown) => JSON.stringify(a);
type Row = {
  base: number[];
  actions: number[][];
  target: number[];
  teacher: number;
  baseline: number;
  count: number;
  epoch: number;
  phase: string;
  finalRank: number;
  seed: number;
  step: number;
};
const frozenManifest = JSON.parse(
  await readFile("artifacts/frozen-uct4/wasm-build.json", "utf8"),
);
const games: {
  split: string;
  seed: number;
  path: string;
  sha256: string;
  rows: Row[];
}[] = [];
for (const job of index.jobs) {
  const raw = await readFile(job.path, "utf8"),
    trace = JSON.parse(raw);
  if (
    trace.audit.metadata.build.wasmSha256 !== frozenManifest.wasmSha256 ||
    trace.audit.metadata.build.sourceSha256 !== frozenManifest.sourceSha256
  )
    throw Error("Mixed teacher builds");
  let s = newGame(trace.config);
  const rows: Row[] = [];
  for (let i = 0; i < trace.actions.length; i++) {
    const d = trace.audit.decisions[i],
      r = d.report;
    if (
      d.player !== s.current ||
      d.step !== i + 1 ||
      key(r.action) !== key(trace.actions[i])
    )
      throw Error("Trace misalignment");
    if (r.candidates.length > 1) {
      const publicState = observe(s),
        actions = candidateActions(publicState),
        reports = new Map(r.candidates.map((c: any) => [key(c.action), c]));
      const visits = actions.map(
          (a) => (reports.get(key(a)) as any)?.visits ?? -1,
        ),
        sum = visits.reduce((a, b) => a + b, 0);
      if (
        visits.some((v) => v < 0) ||
        sum !== r.samples ||
        sum === 0 ||
        actions.length !== r.candidates.length
      )
        throw Error("Candidate coverage mismatch");
      const teacher = actions.findIndex((a) => key(a) === key(r.action)),
        baseline = actions.findIndex(
          (a) => key(a) === key(ai.policy(publicState)),
        );
      if (teacher < 0 || baseline < 0)
        throw Error("Action missing from candidate set");
      rows.push({
        base: policyStateFeatures(publicState),
        actions: actions.map((a) => policyActionFeatures(publicState, a)),
        target: visits.map((n) => n / sum),
        teacher,
        baseline,
        count: s.config.count,
        epoch: s.epoch,
        phase: s.phase,
        finalRank:
          trace.audit.ranking.findIndex((p: any) => p.player === s.current) + 1,
        seed: s.config.seed,
        step: i + 1,
      });
    }
    s = advance(s, trace.actions[i]);
  }
  if (s.phase !== "over" || s.steps !== trace.audit.decisions.length)
    throw Error("Incomplete teacher game");
  games.push({
    split: job.split,
    seed: job.seed,
    path: job.path,
    sha256: sha(raw),
    rows,
  });
}
games.sort((a, b) => a.seed - b.seed);
const dataset = JSON.stringify({
  description:
    "Whole-game split, all players, teacher root-visit probabilities on canonical candidates. Scores, seed, final rank are metadata only, never model inputs.",
  games,
});
await writeFile("artifacts/ai-policy-dataset.json", dataset);
const train = games.filter((g) => g.split === "train").flatMap((g) => g.rows),
  dev = games.filter((g) => g.split === "dev").flatMap((g) => g.rows);
const d = POLICY_INPUTS,
  h = 16,
  n = h * (d + 2) + 1,
  rng = random(825004),
  w = Array.from({ length: n }, () => (rng() - 0.5) * 0.3),
  mom = new Float64Array(n),
  vel = new Float64Array(n);
const pairs = (v: number[]) => v.flatMap((x, i) => (x === 0 ? [] : [[i, x]]));
const cache = new Map<Row, { base: number[][]; actions: number[][][] }>();
for (const r of [...train, ...dev])
  cache.set(r, { base: pairs(r.base), actions: r.actions.map(pairs) });
function forward(r: Row) {
  const x = cache.get(r)!,
    base = Array.from({ length: h }, (_, j) => {
      let z = w[j * (d + 1) + d];
      for (const [k, v] of x.base) z += w[j * (d + 1) + k] * v;
      return z;
    });
  const hidden = x.actions.map((action) =>
    Array.from({ length: h }, (_, j) => {
      let z = base[j];
      for (const [k, v] of action) z += w[j * (d + 1) + 263 + k] * v;
      return Math.tanh(z);
    }),
  );
  const logits = hidden.map(
      (a) => w[n - 1] + a.reduce((v, z, j) => v + w[h * (d + 1) + j] * z, 0),
    ),
    maximum = Math.max(...logits),
    exp = logits.map((v) => Math.exp(v - maximum)),
    sum = exp.reduce((a, b) => a + b, 0);
  return {
    hidden,
    prob: exp.map((v) => v / sum),
    best: logits.indexOf(maximum),
  };
}
function metrics(rows: Row[]) {
  let ce = 0,
    entropy = 0,
    correct = 0,
    baselineCorrect = 0,
    teacherMass = 0;
  for (const r of rows) {
    const f = forward(r);
    r.target.forEach((q, i) => {
      ce -= q * Math.log(Math.max(1e-12, f.prob[i]));
      if (q) entropy -= q * Math.log(q);
    });
    correct += Number(f.best === r.teacher);
    baselineCorrect += Number(r.baseline === r.teacher);
    teacherMass += r.target[f.best];
  }
  return {
    n: rows.length,
    crossEntropy: ce / rows.length,
    kl: (ce - entropy) / rows.length,
    accuracy: correct / rows.length,
    baselineAccuracy: baselineCorrect / rows.length,
    teacherVisitMassOfSelected: teacherMass / rows.length,
  };
}
const history = [];
let step = 0,
  best = Infinity,
  bestW = [...w],
  selectedEpoch = 0;
for (let epoch = 0; epoch < 60; epoch++) {
  const order = Array.from({ length: train.length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let start = 0; start < order.length; start += 32) {
    const batch = order.slice(start, start + 32),
      grad = new Float64Array(n);
    for (const i of batch) {
      const r = train[i],
        x = cache.get(r)!,
        f = forward(r),
        baseGrad = new Float64Array(h);
      for (let c = 0; c < r.actions.length; c++) {
        const err = (f.prob[c] - r.target[c]) / batch.length;
        grad[n - 1] += err;
        for (let j = 0; j < h; j++) {
          const a = f.hidden[c][j];
          grad[h * (d + 1) + j] += err * a;
          const back = err * w[h * (d + 1) + j] * (1 - a * a);
          baseGrad[j] += back;
          for (const [k, v] of x.actions[c])
            grad[j * (d + 1) + 263 + k] += back * v;
        }
      }
      for (let j = 0; j < h; j++) {
        grad[j * (d + 1) + d] += baseGrad[j];
        for (const [k, v] of x.base) grad[j * (d + 1) + k] += baseGrad[j] * v;
      }
    }
    step++;
    const b1 = 1 - 0.9 ** step,
      b2 = 1 - 0.999 ** step;
    for (let k = 0; k < n; k++) {
      const g = grad[k] + 0.0001 * w[k];
      mom[k] = 0.9 * mom[k] + 0.1 * g;
      vel[k] = 0.999 * vel[k] + 0.001 * g * g;
      w[k] -= (0.002 * (mom[k] / b1)) / (Math.sqrt(vel[k] / b2) + 1e-8);
    }
  }
  const m = metrics(dev);
  history.push({ epoch, ...m });
  if (m.crossEntropy < best) {
    best = m.crossEntropy;
    bestW = [...w];
    selectedEpoch = epoch;
  }
  if (epoch % 5 === 0)
    console.log(JSON.stringify({ epoch, train: metrics(train), dev: m }));
}
for (let i = 0; i < n; i++) w[i] = bestW[i];
const model: RolloutModel = {
  version: 1,
  inputs: d,
  hidden: h,
  weights: bestW,
};
validateRolloutModel(model);
const modelText = JSON.stringify(model);
await writeFile("artifacts/ai-rollout-model.json", modelText);
const metadata = {
  trainGames: 64,
  devGames: 16,
  trainDecisions: train.length,
  devDecisions: dev.length,
  trainSeeds: [500001, 500064],
  devSeeds: [600001, 600016],
  finalValidationSeeds: [71001, 71006],
  inputs: d,
  hidden: h,
  parameters: n,
  selectedEpoch,
  modelSha256: sha(modelText),
  datasetSha256: sha(dataset),
  teacher: JSON.parse(
    await readFile("artifacts/frozen-uct4/wasm-build.json", "utf8"),
  ),
  train: metrics(train),
  dev: metrics(dev),
  byCount: [2, 3, 4, 5].map((count) => ({
    count,
    ...metrics(dev.filter((r) => r.count === count)),
  })),
  byPhase: [...new Set(dev.map((r) => r.phase))].map((phase) => ({
    phase,
    ...metrics(dev.filter((r) => r.phase === phase)),
  })),
  byFinalRank: [true, false].map((winner) => ({
    winner,
    ...metrics(dev.filter((r) => (r.finalRank === 1) === winner)),
  })),
  history,
  training:
    "Shared action-conditional287→16tanh→1 logits; softmax CE against UCT200 root visits; Adam lr.002, batch32, L2.0001, 60 epochs; seed825004; choose checkpoint using dev CE only; actual rollout is argmax; no leaf evaluator training.",
};
await writeFile(
  "artifacts/ai-policy-training.json",
  JSON.stringify(metadata, null, 2),
);
console.log(
  JSON.stringify({ ...metadata, history: undefined, teacher: undefined }),
);
