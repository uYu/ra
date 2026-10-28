import { writeFileSync } from "node:fs";
import { advance, newGame, ranking } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { searchAction } from "../src/game/ai/search.ts";
import { searchAction as previousSearch } from "../tests/fixtures/previous-search.ts";
import { searchAction as previousMcts } from "../tests/fixtures/previous-mcts.ts";
import { policyAction } from "../src/game/ai/policy.ts";
import { chooseAction as legacy } from "../tests/fixtures/legacy-ai.ts";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i], process.argv[i + 1]);
const seeds = Number(args.get("--seeds") ?? 3),
  start = Number(args.get("--start") ?? 1001),
  counts = (args.get("--counts") ?? "2,3,4,5").split(",").map(Number),
  samples = Number(args.get("--samples") ?? 32),
  opponent = args.get("--opponent") ?? "legacy",
  candidate = args.get("--candidate") ?? "search",
  allSeats = args.get("--seats") !== "first";
const games: {
  count: number;
  seed: number;
  seat: number;
  rank: number;
  score: number;
  margin: number;
  steps: number;
}[] = [];
const timings: number[] = [],
  started = performance.now();
for (const count of counts)
  for (let n = 0; n < seeds; n++)
    for (let seat = 0; seat < (allSeats ? count : 1); seat++) {
      const seed = start + n;
      let s = newGame({ count, humans: 0, difficulty: "hard", seed });
      while (s.phase !== "over" && s.steps < 1600) {
        const view = observe(s),
          t = performance.now();
        const action =
          s.current === seat
            ? candidate === "policy"
              ? policyAction(view)
              : searchAction(view, { samples }).action
            : opponent === "mcts"
              ? previousMcts(view, { samples }).action
              : opponent === "previous"
                ? previousSearch(view).action
                : opponent === "policy"
                  ? policyAction(view)
                  : legacy(view, opponent === "normal" ? "normal" : "hard");
        if (s.current === seat) timings.push(performance.now() - t);
        s = advance(s, action);
      }
      if (s.phase !== "over")
        throw new Error(`Unfinished ${count}/${seed}/${seat}`);
      const ranks = ranking(s),
        rank = ranks.findIndex((r) => r.player === seat) + 1,
        score = s.players[seat].score,
        margin =
          score -
          Math.max(
            ...s.players.filter((_, i) => i !== seat).map((p) => p.score),
          );
      const row = { count, seed, seat, rank, score, margin, steps: s.steps };
      games.push(row);
      console.log(JSON.stringify(row));
    }
timings.sort((a, b) => a - b);
const summary = counts.map((count) => {
  const rows = games.filter((g) => g.count === count),
    wins = rows.filter((g) => g.rank === 1).length;
  return {
    count,
    games: rows.length,
    wins,
    winRate: wins / rows.length,
    chance: 1 / count,
    score: rows.reduce((v, r) => v + r.score, 0) / rows.length,
    margin: rows.reduce((v, r) => v + r.margin, 0) / rows.length,
  };
});
const report = {
  opponent,
  candidate,
  seeds,
  start,
  samples,
  allSeats,
  summary,
  timing: {
    decisions: timings.length,
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.floor(timings.length * 0.95)],
    maxMs: timings.at(-1),
    seconds: (performance.now() - started) / 1000,
  },
  games,
};
console.log(JSON.stringify({ ...report, games: undefined }, null, 2));
if (args.get("--out"))
  writeFileSync(args.get("--out")!, JSON.stringify(report, null, 2) + "\n");
