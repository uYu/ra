import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const input = resolve(process.argv[2] ?? "artifacts/ai-uct2s-control.json");
const port = Number(process.argv[3] ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid monitor port");
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const key = (g) => `${g.seed}/${g.count}/${g.seat}`;
async function snapshot() {
  const [bytes, file] = await Promise.all([
    readFile(input, "utf8"),
    stat(input),
  ]);
  const raw = JSON.parse(bytes);
  const { start, seeds, counts, config } = raw.identity;
  const games = raw.games;
  const byCount = counts.map((count) => {
    const rows = games.filter((g) => g.count === count);
    return {
      count,
      games: rows.length,
      planned: seeds * count,
      meanRank: mean(rows.map((g) => g.rank)),
      referenceMeanRank: (count + 1) / 2,
      rankScore: mean(rows.map((g) => (count - g.rank) / (count - 1))),
      distribution: Array.from(
        { length: count },
        (_, i) => rows.filter((g) => g.rank === i + 1).length,
      ),
      wins: rows.filter((g) => g.rank === 1).length,
      expectedWins: rows.length / count,
      margin: mean(rows.map((g) => g.margin)),
    };
  });
  const coverage = Array.from({ length: seeds }, (_, i) => {
    const seed = start + i;
    const cells = counts.map((count) => {
      const rows = games.filter((g) => g.seed === seed && g.count === count);
      return {
        count,
        finished: rows.length,
        score: mean(rows.map((g) => (count - g.rank) / (count - 1))),
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
  const jobs = [];
  for (let i = 0; i < seeds; i++)
    for (const count of counts)
      for (let seat = 0; seat < count; seat++)
        jobs.push({ seed: start + i, count, seat });
  const seen = new Set(games.map(key));
  const active =
    raw.inProgress ??
    (raw.status === "running"
      ? jobs
          .slice(0, Math.min(jobs.length, games.length + raw.workers))
          .filter((g) => !seen.has(key(g)))
      : []);
  const timing = ["candidate", "opponent"].map((side) => {
    const rows = [...games, ...(raw.inProgress ?? [])].map(
      (g) => g.stats[side],
    );
    const searched = rows.reduce((n, r) => n + r.searched, 0);
    const sum = (field) => rows.reduce((n, r) => n + r[field], 0);
    return {
      side,
      searched,
      meanMs: searched ? sum("searchMs") / searched : null,
      meanSamples: searched ? sum("samples") / searched : null,
      meanNodes: searched ? sum("nodes") / searched : null,
      maxDepth: Math.max(0, ...rows.map((r) => r.depth)),
      truncated: sum("truncated"),
    };
  });
  const completeBlocks = coverage.filter((b) => b.complete);
  return {
    now: Date.now(),
    updatedAt: file.mtimeMs,
    startedAt: raw.startedAt
      ? Date.parse(raw.startedAt)
      : file.mtimeMs - raw.seconds * 1000,
    elapsedSeconds: raw.seconds,
    status: raw.status,
    finished: games.length,
    planned: raw.plannedGames,
    workers: raw.workers,
    liveProgress: Array.isArray(raw.inProgress),
    lastProgressAt: raw.lastProgressAt ?? null,
    failure: raw.failure ?? null,
    config: { ...config, replayDir: undefined },
    rankScore: byCount.every((r) => r.games > 0)
      ? mean(byCount.map((r) => r.rankScore))
      : null,
    completeBlockScore: mean(completeBlocks.map((b) => b.rankScore)),
    completeBlocks: completeBlocks.length,
    seeds,
    start,
    byCount,
    coverage,
    active,
    timing,
    games: games.map((g) => ({
      seed: g.seed,
      count: g.count,
      seat: g.seat,
      rank: g.rank,
      score: g.score,
      margin: g.margin,
      steps: g.steps,
      candidateMs: g.stats.candidate.searched
        ? g.stats.candidate.searchMs / g.stats.candidate.searched
        : null,
      candidateSamples: g.stats.candidate.searched
        ? g.stats.candidate.samples / g.stats.candidate.searched
        : null,
    })),
  };
}
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
  );
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  try {
    if (request.url === "/api/status") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(await snapshot()));
    } else if (request.url === "/" || request.url === "/index.html") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        await readFile(new URL("monitor-budget.html", import.meta.url)),
      );
    } else response.writeHead(404).end();
  } catch (error) {
    response.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Budget monitor: http://127.0.0.1:${port}`);
  console.log(`Reading: ${input}`);
});
