import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
const directory = resolve(
    process.argv[2] ?? "artifacts/ai-auction-2s-20261029",
  ),
  port = Number(process.argv[3] ?? 8792);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid port");
const load = async (f) =>
  JSON.parse(await readFile(join(directory, f), "utf8"));
const mean = (a) => (a.length ? a.reduce((a, b) => a + b, 0) / a.length : null);
let wakeCache = { checkedAt: 0, active: null };
function wake(pid) {
  if (Date.now() - wakeCache.checkedAt < 10000) return wakeCache;
  try {
    const text = execFileSync("/usr/bin/pmset", ["-g", "assertions"], {
      encoding: "utf8",
      timeout: 1000,
    });
    const lines = text.split("\n");
    const index = lines.findIndex(
      (line, i) =>
        line.includes("(caffeinate)") &&
        line.includes("PreventUserIdleSystemSleep") &&
        lines
          .slice(i + 1, i + 4)
          .some((detail) => detail.includes(`(pid ${pid})`)),
    );
    wakeCache = {
      checkedAt: Date.now(),
      active: index >= 0,
      assertionPid:
        index >= 0 ? Number(lines[index].match(/pid (\d+)/)?.[1]) : null,
    };
  } catch {
    wakeCache = { checkedAt: Date.now(), active: null };
  }
  return wakeCache;
}
async function snapshot() {
  const [plan, raw, run, file] = await Promise.all([
    load("match-plan.json"),
    load("match-results.json"),
    load("run-status.json"),
    stat(join(directory, "match-results.json")),
  ]);
  const turnStudy = plan.configurations.some((c) => c.name === "auction-turn");
  const games = raw.results,
    counts = [2, 3, 4, 5],
    seeds = [...new Set(plan.jobs.map((j) => j.seed))].sort((a, b) => a - b);
  const margin = (g) => {
    const me = g.ranking.find((x) => x.player === g.seat);
    return (
      me.score -
      Math.max(
        ...g.ranking.filter((x) => x.player !== g.seat).map((x) => x.score),
      )
    );
  };
  const byCount = counts.map((count) => {
    const rows = games.filter((g) => g.count === count);
    return {
      count,
      games: rows.length,
      planned: seeds.length * count,
      meanRank: mean(rows.map((g) => g.rank)),
      referenceMeanRank: (count + 1) / 2,
      rankScore: mean(rows.map((g) => g.rankingScore)),
      distribution: Array.from(
        { length: count },
        (_, i) => rows.filter((g) => g.rank === i + 1).length,
      ),
      wins: rows.filter((g) => g.rank === 1).length,
      expectedWins: rows.length / count,
      margin: mean(rows.map(margin)),
    };
  });
  const coverage = seeds.map((seed) => {
    const cells = counts.map((count) => {
      const rows = games.filter((g) => g.seed === seed && g.count === count);
      return {
        count,
        finished: rows.length,
        score: mean(rows.map((g) => g.rankingScore)),
      };
    });
    const complete = cells.every((c) => c.finished === c.count);
    return {
      seed,
      cells,
      complete,
      rankScore: complete ? mean(cells.map((c) => c.score)) : null,
    };
  });
  const active = raw.active.map((x) => ({
    ...x.job,
    epoch: x.epoch ?? 1,
    steps: x.steps ?? 0,
    stats: x.stats,
    scoreboard: x.scoreboard ?? null,
    phase: x.phase,
    updatedAt: x.updatedAt ?? null,
  }));
  const timing = ["candidate", "opponent"].map((side) => {
    const rows = [...games, ...active]
        .map((x) => x.stats?.[side])
        .filter(Boolean),
      sum = (k) => rows.reduce((v, x) => v + (x[k] ?? 0), 0),
      searched = sum("searched");
    return {
      side,
      searched,
      meanMs: searched ? sum("searchMs") / searched : null,
      meanSamples: searched ? sum("samples") / searched : null,
      meanNodes: null,
      maxDepth: null,
      truncated: sum("truncated"),
    };
  });
  const complete = coverage.filter((x) => x.complete),
    startedAt = Date.parse(run.startedAt),
    finished = run.status === "complete-verified" || run.status === "failed";
  const status =
    run.status === "complete-verified"
      ? "complete"
      : run.status === "failed" || raw.status === "failed"
        ? "failed"
        : run.status === "verifying"
          ? "verifying"
          : "running";
  return {
    now: Date.now(),
    updatedAt: file.mtimeMs,
    startedAt,
    elapsedSeconds:
      ((finished ? Date.parse(run.updatedAt) : Date.now()) - startedAt) / 1000,
    status,
    finished: games.length,
    planned: plan.jobs.length,
    workers: plan.workers,
    liveProgress: true,
    lastProgressAt: file.mtimeMs,
    failure: run.error ?? null,
    config: {
      description: `${turnStudy ? "拍卖时机增强 vs 已验证拍卖版" : "拍卖穷举＋抽样续局 vs 原 UCT"} · 双方 ${plan.timeMs / 1000} 秒 · 跨下一纪元 · ${plan.workers} 路并行`,
      candidateLabel: turnStudy ? "拍卖时机增强" : "拍卖穷举",
      opponentLabel: turnStudy ? "已验证拍卖版" : "原 UCT",
      liveScores: active.some((g) => g.scoreboard?.length),
      studyKind: turnStudy ? "auction-turn" : "auction-2s",
    },
    rankScore: byCount.every((x) => x.games)
      ? mean(byCount.map((x) => x.rankScore))
      : null,
    completeBlockScore: mean(complete.map((x) => x.rankScore)),
    completeBlocks: complete.length,
    seeds: seeds.length,
    start: seeds[0],
    byCount,
    coverage,
    active,
    timing,
    wake: wake(run.supervisorPid),
    runStatus: run.status,
    confidenceInterval: run.confidenceInterval ?? null,
    games: games.map((g) => ({
      seed: g.seed,
      count: g.count,
      seat: g.seat,
      rank: g.rank,
      score: g.ranking.find((x) => x.player === g.seat).score,
      margin: margin(g),
      steps: g.steps,
      candidateSamples: g.stats.candidate.searched
        ? g.stats.candidate.samples / g.stats.candidate.searched
        : null,
    })),
  };
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
  );
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  try {
    if (req.url === "/api/status") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(await snapshot()));
    } else if (req.url === "/" || req.url === "/index.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        await readFile(new URL("monitor-auction-2s.html", import.meta.url)),
      );
    } else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Auction study monitor: http://127.0.0.1:${port}/`),
);
