import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWasmAi } from "../src/game/ai/wasm-frozen-uct4.ts";
import { newGame, advance } from "../src/game/engine.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";
if (!isMainThread) {
  const bytes = await readFile("artifacts/frozen-uct4/ra-ai.wasm");
  const manifest = JSON.parse(
    await readFile("artifacts/frozen-uct4/wasm-build.json", "utf8"),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.wasmSha256)
    throw Error("Frozen teacher checksum mismatch");
  const ai = await createWasmAi(bytes);
  parentPort!.on("message", async (job) => {
    try {
      let s = newGame({
        count: job.count,
        seed: job.seed,
        humans: 0,
        difficulty: "hard",
      });
      const rec = recorder(s.config);
      while (s.phase !== "over" && s.steps < 1600) {
        const start = performance.now(),
          report = ai.search(s, { timeMs: 200 });
        rec.record(s, report, performance.now() - start);
        s = advance(s, report.action);
      }
      const trace = rec.finish(s, {
        ...job,
        teacher:
          "Frozen ABI4 original UCT, 200ms, original epoch evaluator, all seats",
        build: manifest,
      });
      await saveTrace(job.path, trace);
      parentPort!.postMessage({ done: job });
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const jobs = [
    ...Array.from({ length: 64 }, (_, i) => ({
      split: "train",
      seed: 500001 + i,
      count: 2 + (i % 4),
    })),
    ...Array.from({ length: 16 }, (_, i) => ({
      split: "dev",
      seed: 600001 + i,
      count: 2 + (i % 4),
    })),
  ].map((j) => ({
    ...j,
    path: `artifacts/policy-teacher/${j.split}-${j.count}p-${j.seed}.json`,
  }));
  const complete = [],
    todo = [];
  for (const job of jobs) {
    try {
      await access(job.path);
      const t = JSON.parse(await readFile(job.path, "utf8"));
      if (
        t.audit.metadata.split !== job.split ||
        t.config.seed !== job.seed ||
        t.audit.decisions.length !== t.actions.length
      )
        throw Error("Invalid teacher trace");
      complete.push(job);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      todo.push(job);
    }
  }
  let next = 0;
  const live: Worker[] = [];
  const checkpoint = async () =>
    writeFile(
      "artifacts/policy-teacher-index.json",
      JSON.stringify(
        {
          description:
            "All decisions from complete frozen UCT200 games, every seat, no win/loss filtering, game-level train/dev split; final evaluation71001..71006 untouched.",
          planned: jobs.length,
          complete: complete.length,
          jobs: complete.sort((a, b) => a.seed - b.seed),
        },
        null,
        2,
      ),
    );
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(8, todo.length) },
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
                complete.push(m.done);
                console.log(
                  JSON.stringify({
                    finished: complete.length,
                    total: jobs.length,
                    ...m.done,
                  }),
                );
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
    await checkpoint();
  }
}
