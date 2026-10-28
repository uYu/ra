import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { createWasmAi as frozenAi } from "../src/game/ai/wasm-frozen-uct3.ts";
import { advance, newGame } from "../src/game/engine.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";
if (!isMainThread) {
  const modelText = await readFile("artifacts/ai-value-model.json", "utf8"),
    model = JSON.parse(modelText);
  const current = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
  const old = await frozenAi(
    await readFile("artifacts/frozen-uct3/ra-ai.wasm"),
  );
  parentPort!.on("message", async (job) => {
    try {
      const ai = job.study === "value" ? current : old;
      let s = newGame({
        count: job.count,
        seed: job.seed,
        humans: 0,
        difficulty: "hard",
      });
      const rec = recorder(s.config);
      while (s.phase !== "over" && s.steps < 1600) {
        const start = performance.now(),
          candidate = s.current === job.seat;
        const report = ai.search(s, {
          samples: 32,
          ...(job.study === "value" || candidate ? { timeMs: 200 } : {}),
          ...(job.study === "value" && candidate ? { valueModel: model } : {}),
        });
        rec.record(s, report, performance.now() - start);
        s = advance(s, report.action);
      }
      const path = `artifacts/decision-replays/${job.study}-${job.count}p-${job.seed}-seat${job.seat}.json`;
      const trace = rec.finish(s, {
        ...job,
        reRun: true,
        selection:
          "Worst recorded final margin separately for each study and 2p/5p; selected before rerun. This is targeted diagnosis, not a new strength estimate.",
        timeMs: 200,
        samples: 32,
        modelSha256:
          job.study === "value"
            ? createHash("sha256").update(modelText).digest("hex")
            : null,
      });
      await saveTrace(path, trace);
      parentPort!.postMessage({
        done: { ...job, path, ranking: trace.audit.ranking, steps: s.steps },
      });
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const jobs = [];
  for (const [study, file] of [
    ["value", "artifacts/ai-value-validation.json"],
    ["budget", "artifacts/ai-uct200-control.json"],
  ]) {
    const r = JSON.parse(await readFile(file, "utf8"));
    for (const count of [2, 5]) {
      const g = r.games
        .filter((g: any) => g.count === count)
        .sort((a: any, b: any) => a.margin - b.margin)[0];
      jobs.push({
        study,
        count,
        seed: g.seed,
        seat: g.seat,
        originalRank: g.rank,
        originalMargin: g.margin,
      });
    }
  }
  let next = 0;
  const results: any[] = [],
    live: Worker[] = [];
  try {
    await Promise.all(
      Array.from(
        { length: 2 },
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
              if (m.done) {
                results.push(m.done);
                console.log(JSON.stringify(m.done));
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
  await writeFile(
    "artifacts/decision-replay-index.json",
    JSON.stringify(
      {
        selection:
          "Targeted reruns of four worst-margin examples; not original timed action histories.",
        results,
      },
      null,
      2,
    ),
  );
}
