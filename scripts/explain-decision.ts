import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { replay } from "../src/game/storage.ts";
import { observe } from "../src/game/ai.ts";
import { random, shuffle } from "../src/game/data.ts";
import { futureValues, relative } from "../src/game/ai/evaluation.ts";
import { learnedFuture } from "../src/game/ai/value.ts";
import type { State, Action } from "../src/game/types.ts";
const findings = JSON.parse(
  await readFile("artifacts/decision-analysis.json", "utf8"),
);
const chosenCase = findings.cases.find((r: any) => r.robustWithinReviewers);
if (!chosenCase) throw new Error("No confirmed case to explain");
const trace = JSON.parse(await readFile(chosenCase.job.path, "utf8"));
const root = replay(trace, chosenCase.job.step - 1);
const model = JSON.parse(
  await readFile("artifacts/ai-value-model.json", "utf8"),
);
const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
const scores = (s: State) => s.players.map((p) => p.score - 100);
const reward = (values: number[]) =>
  relative(values, root.current, root.players.length === 2 ? 1 : 0.72);
const stats = (v: number[]) => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length,
    se = Math.sqrt(
      v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1) / v.length,
    );
  return {
    n: v.length,
    mean,
    se,
    low95: mean - 1.96 * se,
    high95: mean + 1.96 * se,
  };
};
function rollout(action: Action, index: number, strong = false) {
  let s = observe(root);
  s.players.forEach((p) => (p.score = 100));
  s.bag = shuffle(
    [...s.bag].sort((a, b) => a.id - b.id),
    random(
      (Math.imul(root.steps + 1, 1398013) ^
        Math.imul(index + 1, 479001599) ^
        0x35a271de) >>>
        0,
    ),
  );
  s = ai.simulate(s, action);
  let steps = 0;
  const pick = (s: State) =>
    strong ? ai.search(s, { samples: 32 }).action : ai.policy(s);
  while (s.phase !== "epoch" && s.phase !== "over" && steps++ < 900)
    s = ai.simulate(s, pick(s));
  const current = reward(scores(s)),
    old = reward(scores(s).map((v, i) => v + futureValues(s)[i])),
    learned = reward(scores(s).map((v, i) => v + learnedFuture(s, model)[i]));
  const epochEnd = {
    scores: scores(s),
    suns: s.players.map((p) => [...p.suns, ...p.used].sort((a, b) => a - b)),
    tiles: s.players.map((p) =>
      p.tiles.map((t) => ({ kind: t.kind, variant: t.variant })),
    ),
  };
  while (s.phase !== "over" && steps++ < 900) s = ai.simulate(s, pick(s));
  if (s.phase !== "over") throw Error("Incomplete diagnostic rollout");
  return { current, old, learned, final: reward(scores(s)), epochEnd };
}
const heuristic = Array.from({ length: 256 }, (_, i) => {
  const a = rollout(chosenCase.job.chosen, 20000 + i),
    b = rollout(chosenCase.job.alternatives[0], 20000 + i);
  return {
    current: b.current - a.current,
    old: b.old - a.old,
    learned: b.learned - a.learned,
    final: b.final - a.final,
  };
});
const decomposition = Object.fromEntries(
  ["current", "old", "learned", "final"].map((k) => [
    k,
    stats(heuristic.map((r: any) => r[k])),
  ]),
);
console.log(JSON.stringify({ decomposition }));
const searches = [];
for (const horizon of ["epoch", "game"] as const)
  for (const useModel of [false, true])
    for (const samples of [32, 128, 512]) {
      const r = ai.search(root, {
        horizon,
        samples,
        ...(useModel ? { valueModel: model } : {}),
      });
      searches.push({
        horizon,
        useModel,
        samples,
        action: r.action,
        simulations: r.samples,
        candidates: r.candidates,
      });
    }
console.log(
  JSON.stringify({
    searches: searches.map((s) => ({ ...s, candidates: undefined })),
  }),
);
const strong = [];
for (let i = 0; i < 32; i++) {
  const a = rollout(chosenCase.job.chosen, 30000 + i, true),
    b = rollout(chosenCase.job.alternatives[0], 30000 + i, true);
  strong.push(b.final - a.final);
  if (i % 8 === 7) console.log(JSON.stringify({ strongWorlds: i + 1 }));
}
const output = {
  case: {
    path: chosenCase.job.path,
    step: chosenCase.job.step,
    chosen: chosenCase.job.chosen,
    alternative: chosenCase.job.alternatives[0],
  },
  description:
    "Independent paired worlds 20000..20255 for leaf decomposition with balanced policy; 30000..30031 for adaptive UCT32 continuation. Results are conditional policy diagnostics, not a proof of optimal play.",
  decomposition,
  searches,
  strongContinuation: stats(strong),
};
await writeFile(
  "artifacts/decision-decomposition.json",
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify({ strongContinuation: output.strongContinuation }));
