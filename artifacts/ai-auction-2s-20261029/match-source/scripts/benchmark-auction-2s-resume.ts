import { checkSearchTiming } from "./auction-sampling/timing-cap.ts";
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
import { join, resolve } from "node:path";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { newGame, advance, ranking, scoreEpoch } from "../src/game/engine.ts";
import { random } from "../src/game/data.ts";
import { recorder, saveTrace } from "./lib/decision-trace.ts";
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
type Job = {
  seed: number;
  count: number;
  seat: number;
  configuration: "auction-rollout";
};
const key = (j: Job) => `${j.configuration}/${j.seed}/${j.count}/${j.seat}`;
const blank = () => ({
  decisions: 0,
  searched: 0,
  ms: 0,
  searchMs: 0,
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
        native.configure_auction_study(candidate ? 1 : 0);
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
            native.auction_study_metrics(),
            8,
          ),
          row = stats[side];
        Object.assign(report, {
          study: {
            configuration: c.name,
            timeMs: plan.timeMs,
            horizon: "next-epoch",
            plannedCutoffs: 0,
            auctionMode: metrics[0] === 1,
            auctionRounds: metrics[1],
            distinctOutcomes: metrics[2],
            auctionNodes: metrics[3],
            rolloutTransitions: 0,
          },
        });
        row.decisions++;
        row.ms += elapsed;
        row.maxMs = Math.max(row.maxMs, elapsed);
        row.samples += report.samples;
        row.transitions += report.transitions;
        row.truncated += report.truncated;
        row.plannedCutoffs += 0;
        row.rolloutTransitions += 0;
        if (report.samples) {
          row.searched++;
          row.searchMs += elapsed;
          if (checkSearchTiming(elapsed, report.samples, metrics[0] === 1, plan.timeMs)) {
            console.log(JSON.stringify({timingCap: true, job, step: s.steps + 1, phase: s.phase, elapsed, samples: report.samples}));
          }
        }
        recording.record(s, report, elapsed);
        s = advance(s, report.action);
        if (Date.now() - lastProgress > 5000) {
          lastProgress = Date.now();
          parentPort!.postMessage({
            progress: {
              job, steps: s.steps, epoch: s.epoch, phase:s.phase, stats,
              updatedAt:Date.now(),
              scoreboard:s.players.map((p,i)=>{
                const delta=s.phase==="epoch"||s.phase==="over"?0:scoreEpoch(s)[i].delta;
                return {player:i,name:p.name,candidate:i===job.seat,banked:p.score,epochDelta:delta,projected:p.score+delta};
              }),
            },
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
      process.argv[2] ?? "artifacts/ai-auction-2s-20261029",
    ),
    smoke = process.argv.includes("--smoke"),
    stem = smoke ? "match-smoke" : "match";
  const planPath = join(directory, `${stem}-plan.json`),
    resultsPath = join(directory, `${stem}-results.json`);
  const planBytes=await readFile(planPath),plan=JSON.parse(planBytes.toString());
  const planSha256=sha(planBytes),snapshot=plan.snapshot,hashes=plan.hashes;
  for(const[path,hash]of Object.entries(hashes))assert.equal(sha(await readFile(path)),hash,path);
  const configurations=plan.configurations as {name:string}[],jobs:Job[]=plan.jobs;
  const previous=JSON.parse(await readFile(resultsPath,"utf8"));
  assert.equal(previous.planSha256,planSha256);
  const results:any[]=previous.results;
  assert.equal(new Set(results.map(key)).size,results.length);
  const done=new Set(results.map(key));
  const pending=jobs.filter(j=>!done.has(key(j)));
  const active=new Map<string,unknown>(),workers:Worker[]=[];
  let next=0,failure:unknown,saving=Promise.resolve();
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
        { length: Math.min(plan.workers, pending.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(
              fileURLToPath(import.meta.url),
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
                if (next < pending.length) {
                  const job = pending[next++];
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
