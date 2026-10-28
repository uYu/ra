import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { replay } from "../src/game/storage.ts";
import { ranking } from "../src/game/engine.ts";
import type { Trace } from "./lib/decision-trace.ts";
const mean = (a: number[]) => a.reduce((n, v) => n + v, 0) / a.length;
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
function bootstrap(blocks: number[]) {
  let rng = 0x5a17c02;
  const next = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) / 4294967296;
  };
  const draws = Array.from({ length: 100000 }, () =>
    mean(blocks.map(() => blocks[Math.floor(next() * blocks.length)])),
  ).sort((a, b) => a - b);
  const ci = (alpha: number) => [
    draws[Math.floor((draws.length * alpha) / 2)],
    draws[
      Math.min(draws.length - 1, Math.floor(draws.length * (1 - alpha / 2)))
    ],
  ];
  return { interval95: ci(0.05), intervalFamily3: ci(0.05 / 3) };
}
assert.deepEqual(bootstrap([0.5, 0.5]).interval95, [0.5, 0.5]);
for (const n of [2, 3, 4, 5])
  assert.equal(
    mean(Array.from({ length: n }, (_, rank) => (n - rank - 1) / (n - 1))),
    0.5,
  );
const plan = JSON.parse(
  await readFile("artifacts/ai-sh-study-manifest.json", "utf8"),
);
for (const [path, hash] of Object.entries(plan.identity.hashes))
  assert.equal(
    sha(await readFile(path)),
    hash,
    `Study source changed: ${path}`,
  );
type Row = {
  count: number;
  seed: number;
  seat: number;
  rank: number;
  score: number;
  margin: number;
  steps: number;
  replayPath: string;
  stats: Record<"candidate" | "opponent", Record<string, number>>;
};
const score = (g: Row) => (g.count - g.rank) / (g.count - 1);
const results = [];
let replayCount = 0,
  decisions = 0;
for (const group of plan.identity.groups) {
  const path = `artifacts/ai-sh-${group.id}.json`;
  const bytes = await readFile(path);
  const raw = JSON.parse(bytes.toString());
  assert.equal(raw.status, "complete");
  assert.equal(raw.finishedGames, 280);
  assert.equal(raw.plannedGames, 280);
  const rows: Row[] = raw.games;
  assert.equal(rows.length, 280);
  const config = raw.identity.config;
  assert.equal(config.engine, group.engine);
  assert.equal(config.reward, group.reward);
  assert.equal(config.opponentVariant, group.opponent);
  assert.equal(config.timeMs, group.time);
  assert.equal(config.samples, 32);
  assert.equal(config.valueModel, undefined);
  assert.equal(config.rolloutModel, undefined);
  assert.ok(!config.opponentFixed);
  assert.deepEqual(raw.identity.counts, [2, 3, 4, 5]);
  assert.deepEqual(raw.identity.variants, ["sh"]);
  assert.deepEqual(raw.identity.modes, ["time"]);
  const expectedSource =
    group.engine === "frozen5"
      ? "artifacts/frozen-uct5/ra_ai.cpp"
      : "native/ra_ai.cpp";
  const expectedWasm =
    group.engine === "frozen5"
      ? "artifacts/frozen-uct5/ra-ai.wasm"
      : "src/game/ai/ra-ai.wasm";
  assert.equal(raw.identity.sourceSha256, plan.identity.hashes[expectedSource]);
  assert.equal(raw.identity.wasmSha256, plan.identity.hashes[expectedWasm]);
  const keys = new Set();
  const timings = { candidate: [] as number[], opponent: [] as number[] };
  for (const g of rows) {
    assert.ok(Number.isInteger(g.rank) && g.rank >= 1 && g.rank <= g.count);
    assert.ok(Number.isInteger(g.seat) && g.seat >= 0 && g.seat < g.count);
    const key = `${g.seed}/${g.count}/${g.seat}`;
    assert.ok(!keys.has(key));
    keys.add(key);
    const trace: Trace = JSON.parse(await readFile(g.replayPath, "utf8"));
    assert.equal(trace.config.seed, g.seed);
    assert.equal(trace.config.count, g.count);
    assert.equal(
      trace.audit.metadata.build &&
        (trace.audit.metadata.build as any).wasmSha256,
      raw.identity.wasmSha256,
    );
    assert.equal(trace.audit.metadata.reward, group.reward);
    assert.equal(trace.audit.metadata.opponentVariant, group.opponent);
    assert.equal(trace.audit.metadata.timeMs, group.time);
    assert.equal(trace.audit.actionsSha256, sha(JSON.stringify(trace.actions)));
    assert.equal(trace.actions.length, g.steps);
    assert.equal(trace.audit.decisions.length, g.steps);
    const final = replay(trace);
    assert.equal(final.phase, "over");
    assert.equal(final.steps, g.steps);
    const ranks = ranking(final);
    assert.deepEqual(ranks, trace.audit.ranking);
    assert.deepEqual(final.history, trace.audit.history);
    assert.equal(ranks.findIndex((p) => p.player === g.seat) + 1, g.rank);
    assert.equal(final.players[g.seat].score, g.score);
    assert.equal(
      g.margin,
      g.score -
        Math.max(
          ...final.players.filter((_, i) => i !== g.seat).map((p) => p.score),
        ),
    );
    trace.audit.decisions.forEach((d, i) => {
      assert.equal(d.step, i + 1);
      assert.deepEqual(d.report.action, trace.actions[i]);
      assert.ok(Number.isFinite(d.elapsedMs) && d.elapsedMs >= 0);
      if (d.report.samples)
        timings[d.player === g.seat ? "candidate" : "opponent"].push(
          d.elapsedMs,
        );
    });
    replayCount++;
    decisions += trace.actions.length;
  }
  const bySeed = Array.from({ length: 20 }, (_, i) => {
    const seed = group.start + i;
    const byCount = [2, 3, 4, 5].map((n) => {
      const r = rows.filter((g) => g.seed === seed && g.count === n);
      assert.deepEqual(
        r.map((g) => g.seat).sort((a, b) => a - b),
        Array.from({ length: n }, (_, i) => i),
      );
      return mean(r.map(score));
    });
    return { seed, balancedRankScore: mean(byCount) };
  });
  const byCount = [2, 3, 4, 5].map((count) => {
    const r = rows.filter((g) => g.count === count);
    return {
      count,
      games: r.length,
      meanRank: mean(r.map((g) => g.rank)),
      rankScore: mean(r.map(score)),
      rankDistribution: Array.from(
        { length: count },
        (_, i) => r.filter((g) => g.rank === i + 1).length,
      ),
      firstPlaces: r.filter((g) => g.rank === 1).length,
    };
  });
  const costs = Object.fromEntries(
    (["candidate", "opponent"] as const).map((role) => {
      const t = timings[role].sort((a, b) => a - b);
      const stats = rows.map((g) => g.stats[role]);
      const sum = (key: string) => stats.reduce((n, r) => n + r[key], 0);
      assert.equal(t.length, sum("searched"));
      return [
        role,
        {
          searched: t.length,
          meanSearchMs: mean(t),
          medianMs: t[Math.floor(t.length / 2)],
          p95Ms: t[Math.floor(t.length * 0.95)],
          maxMs: t[t.length - 1],
          meanSimulations: sum("samples") / t.length,
          meanOvershootMs: sum("overshootMs") / t.length,
          overrun10msFraction: sum("overrunCalls") / t.length,
          truncationFraction: sum("truncated") / sum("samples"),
          decisions: sum("decisions"),
        },
      ];
    }),
  );
  const blocks = bySeed.map((b) => b.balancedRankScore);
  results.push({
    id: group.id,
    file: path,
    sha256: sha(bytes),
    games: rows.length,
    balancedRankScore: mean(blocks),
    gameWeightedRankScore: mean(rows.map(score)),
    ...bootstrap(blocks),
    byCount,
    bySeed,
    firstPlaces: rows.filter((g) => g.rank === 1).length,
    costs,
    seconds: raw.seconds,
    workers: raw.workers,
  });
  console.log(
    JSON.stringify({
      verified: group.id,
      games: rows.length,
      balancedRankScore: mean(blocks),
    }),
  );
}
const [low, high, rank] = results;
const differences = high.bySeed.map((b, i) => {
  assert.equal(b.seed, low.bySeed[i].seed);
  return b.balancedRankScore - low.bySeed[i].balancedRankScore;
});
const budgetComparison = {
  label:
    "SH vs UCT performance at 500ms minus performance at 200ms (not a direct SH500 vs SH200 match)",
  meanDifference: mean(differences),
  ...bootstrap(differences),
  bySeed: differences,
};
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const ci = (v: number[]) => v.map(pct).join("–");
const summary = {
  createdAt: new Date().toISOString(),
  primary: "Equal-weighted player counts, normalized rank score",
  seedBlocks: 20,
  bootstrapReplicates: 100000,
  bootstrapSeed: "0x5a17c02",
  reference: 0.5,
  results,
  budgetComparison,
  qa: {
    replayCount,
    decisions,
    allReplaysLegalAndComplete: true,
    duplicates: 0,
    sourceHashesVerified: true,
  },
  default: "UCT / original relative reward; experimental options disabled",
};
await writeFile(
  "artifacts/ai-sh-study-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
const supported = low.interval95[0] > 0.5;
const lines = [
  "# Anytime SH 独立复测、预算与排名奖励",
  "",
  `三组各 280 局，共 ${replayCount} 局、${decisions.toLocaleString("en-US")} 步完整棋谱；每组 20 个独立种子，按 2–5 人全部座位轮换。协议见 [预先固定的实验设计](ai-sh-confirmation-methods.md)。`,
  "",
  "| 组别 | 对照 | 2人平均名次 | 3人 | 4人 | 5人 | 等权排名分 | 种子块95%区间 | 三组校正区间 |",
  "|---|---|---:|---:|---:|---:|---:|---|---|",
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.id === "rank200" ? "SH排名代理 vs SH相对分差，双方200ms" : `SH vs UCT，双方${r.id === "sh200" ? 200 : 500}ms`} | ${r.byCount.map((c) => c.meanRank.toFixed(2)).join(" | ")} | ${pct(r.balancedRankScore)} | ${ci(r.interval95)} | ${ci(r.intervalFamily3)} |`,
  ),
  "",
  "等强参考平均名次：1.50 / 2.00 / 2.50 / 3.00；等权排名分50%。区间按整个种子重采样，不将280局视为独立样本。三组校正采用Bonferroni，每组98.333%区间。",
  "",
  `200ms复测${supported ? "达到" : "未达到"}预先设定的优势支持标准（95%区间下限超过50%）。${supported && low.intervalFamily3[0] <= 0.5 ? "但三组校正区间仍覆盖50%，结论应保留。" : ""}`,
  "",
  `双方从200ms提高到500ms后，SH相对UCT的排名表现变化为 ${(budgetComparison.meanDifference * 100).toFixed(1)} 个百分点，配对种子95%区间 ${ci(budgetComparison.interval95)}。这是相对竞争力的预算曲线，不能证明SH500直接强于SH200，因为对手也提高了预算。`,
  "",
  `排名代理组为 ${pct(rank.balancedRankScore)}，95%区间 ${ci(rank.interval95)}。它单独对照相同SH的原奖励；不与UCT组拼成统一排行榜。`,
  "",
  "## 实际搜索成本",
  "",
  "| 组别 | 角色 | 平均搜索ms | p95ms | 每次模拟数 | 超预算10ms占比 | 截断模拟比例 |",
  "|---|---|---:|---:|---:|---:|---:|",
  ...results.flatMap((r) =>
    Object.entries(r.costs).map(
      ([role, c]: [string, any]) =>
        `| ${r.id} | ${role} | ${c.meanSearchMs.toFixed(2)} | ${c.p95Ms.toFixed(2)} | ${c.meanSimulations.toFixed(1)} | ${pct(c.overrun10msFraction)} | ${pct(c.truncationFraction)} |`,
    ),
  ),
  "",
  "每次预算是软墙钟时限；完整模拟、根候选覆盖、桥接及线程调度会产生超时。以上是并发对局的实际搜索成本，不是隔离CPU性能基准。",
  "",
  "## 解释边界与留存",
  "",
  "future-rank比较的是本次模拟新增分数加原未来估值的两两胜出比例，同分半分；所有累计分仍在搜索起点统一，未读取对手真实隐藏分数。它是后续得分排名代理，不是最终全局名次概率。离散奖励的尺度/形状变化与目标变化同时发生；该组结果不能单独归因于目标对齐。",
  "",
  "全部棋谱已逐局正式引擎重放，验证合法性、终局排名、分差、历史、动作SHA256及构建哈希。机器可读逐种子结果、名次分布、实际成本与配对预算分析见 [完整汇总](ai-sh-study-summary.json)。原始文件：ai-sh-sh200.json、ai-sh-sh500.json、ai-sh-rank200.json；各自棋谱位于同名文件加.replays/目录。",
  "",
  "生产默认保持UCT与原奖励；实验参数没有自动启用。",
];
await writeFile("artifacts/ai-sh-study-report.md", lines.join("\n") + "\n");
console.log(
  JSON.stringify({
    report: "artifacts/ai-sh-study-report.md",
    games: replayCount,
    decisions,
    supported200: supported,
    budgetComparison,
  }),
);
