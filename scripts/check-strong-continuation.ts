import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { replay } from "../src/game/storage.ts";
import { observe } from "../src/game/ai.ts";
import { random, shuffle } from "../src/game/data.ts";
import { relative } from "../src/game/ai/evaluation.ts";
import type { Action } from "../src/game/types.ts";
const explanation = JSON.parse(
  await readFile("artifacts/decision-decomposition.json", "utf8"),
);
const trace = JSON.parse(await readFile(explanation.case.path, "utf8"));
const root = replay(trace, explanation.case.step - 1);
if (!isMainThread) {
  const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
  const model = JSON.parse(
    await readFile("artifacts/ai-value-model.json", "utf8"),
  );
  function rollout(action: Action, index: number, useModel: boolean) {
    let s = observe(root);
    s.players.forEach((p) => (p.score = 100));
    s.bag = shuffle(
      [...s.bag].sort((a, b) => a.id - b.id),
      random(
        (Math.imul(root.steps + 1, 1398013) ^
          Math.imul(index + 30001, 479001599) ^
          0x35a271de) >>>
          0,
      ),
    );
    s = ai.simulate(s, action);
    let steps = 0;
    while (s.phase !== "over" && steps++ < 900) {
      const a = ai.search(s, {
        samples: 32,
        ...(useModel && s.current === root.current
          ? { valueModel: model }
          : {}),
      }).action;
      s = ai.simulate(s, a);
    }
    if (s.phase !== "over") throw Error("Incomplete strong continuation");
    return relative(
      s.players.map((p) => p.score - 100),
      root.current,
      root.players.length === 2 ? 1 : 0.72,
    );
  }
  parentPort!.on("message", ({ index, useModel }) => {
    try {
      const actual = rollout(explanation.case.chosen, index, useModel),
        alternative = rollout(explanation.case.alternative, index, useModel);
      parentPort!.postMessage({
        row: {
          index,
          useModel,
          actual,
          alternative,
          difference: alternative - actual,
        },
      });
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const jobs = [false, true].flatMap((useModel) =>
    Array.from({ length: 128 }, (_, index) => ({ index, useModel })),
  );
  let next = 0;
  const rows: any[] = [],
    live: Worker[] = [];
  try {
    await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url));
            live.push(w);
            w.on("error", reject);
            w.on("message", (m) => {
              if (m.error) {
                reject(new Error(m.error));
                return;
              }
              if (m.row) {
                rows.push(m.row);
                if (rows.length % 16 === 0)
                  console.log(
                    JSON.stringify({
                      finished: rows.length,
                      total: jobs.length,
                    }),
                  );
              }
              if (next < jobs.length) w.postMessage(jobs[next++]);
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
  }
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
  const first32 = stats(
    rows.filter((r) => !r.useModel && r.index < 32).map((r) => r.difference),
  );
  if (first32.mean !== explanation.strongContinuation.mean)
    throw Error("Strong continuation reproduction failed");
  const summaries = [false, true].map((useModel) => ({
    useModel,
    ...stats(
      rows.filter((r) => r.useModel === useModel).map((r) => r.difference),
    ),
  }));
  const output = {
    case: explanation.case,
    description:
      "128 paired unseen worlds per continuation profile, range30000..30127, fixed UCT32 all seats. Profilefalse uses original evaluator for everyone; profiletrue uses learned evaluator only for the focal player. Alternative-minus-actual relative final score; public root and normalized100 scores; first32 original-profile worlds exactly reproduce preliminary diagnostic.",
    summaries,
    rows: rows.sort(
      (a, b) => Number(a.useModel) - Number(b.useModel) || a.index - b.index,
    ),
  };
  await writeFile(
    "artifacts/decision-strong-continuation.json",
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(summaries, null, 2));
}
