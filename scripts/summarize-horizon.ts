import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

type Row = {
  count: number;
  seed: number;
  seat: number;
  rank: number;
  stats: Record<
    "candidate" | "opponent",
    { samples: number; truncated: number; epochAdvances: number }
  >;
};
type Report = {
  status: string;
  candidate: { horizon: string; samples: number };
  opponent: { horizon: string; samples: number };
  seeds: number;
  seedStart: number;
  counts: number[];
  finishedGames: number;
  plannedGames: number;
  sourceSha256: string;
  wasmSha256: string;
  summary: { count: number; games: number; wins: number; meanMargin: number }[];
  games: Row[];
  costSummary: {
    variant: string;
    positions: number;
    totalMs: number;
    medianMs: number;
    p95Ms: number;
    truncated: number;
  }[];
};
const files = [
  "artifacts/ai-next-epoch-validation.json",
  "artifacts/ai-next-epoch-budget-control.json",
];
const reports: Report[] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(f, "utf8"))),
);
for (const r of reports) {
  assert.deepEqual(r.counts, [2, 3, 4, 5]);
  assert.equal(r.seeds, 6);
  assert.equal(r.seedStart, 12001);
  assert.equal(
    r.status,
    "complete",
    "Wait for the full planned suite; do not summarize a partial result",
  );
  assert.equal(r.finishedGames, r.plannedGames);
  assert.equal(r.games.length, r.seeds * r.counts.reduce((a, b) => a + b, 0));
  assert.equal(
    new Set(r.games.map((g) => `${g.count}/${g.seed}/${g.seat}`)).size,
    r.games.length,
  );
  for (let seed = r.seedStart; seed < r.seedStart + r.seeds; seed++)
    for (const count of r.counts)
      for (let seat = 0; seat < count; seat++)
        assert.ok(
          r.games.some(
            (g) => g.seed === seed && g.count === count && g.seat === seat,
          ),
        );
  for (const g of r.games) assert.ok(g.rank >= 1 && g.rank <= g.count);
  assert.equal(r.candidate.horizon, "next-epoch");
  assert.equal(r.candidate.samples, 32);
  assert.equal(r.opponent.horizon, "epoch");
}
assert.equal(reports[0].opponent.samples, 32);
assert.equal(reports[1].opponent.samples, 64);
for (const key of ["sourceSha256", "wasmSha256", "seedStart", "seeds"] as const)
  assert.equal(reports[0][key], reports[1][key]);
assert.deepEqual(reports[0].counts, reports[1].counts);

const pct = (n: number) => `${(100 * n).toFixed(1)}%`;
const totals = reports.map((r) => {
  const wins = r.games.filter((g) => g.rank === 1).length;
  return { games: r.games.length, wins, winRate: wins / r.games.length };
});
const referenceWins = reports[0].seeds * reports[0].counts.length;
const sections = reports.map((r, i) => {
  const table = r.summary
    .map(
      (s) =>
        `| ${s.count} | ${s.games} | ${s.wins} | ${pct(s.wins / s.games)} | ${pct(1 / s.count)} | ${s.meanMargin.toFixed(2)} |`,
    )
    .join("\n");
  const trunc = r.games.reduce((v, g) => v + g.stats.candidate.truncated, 0);
  const samples = r.games.reduce((v, g) => v + g.stats.candidate.samples, 0);
  return `## 下一纪元 32 对本纪元 ${r.opponent.samples}\n\n| 人数 | 局数 | 第一名 | 胜率 | 等强参考胜率 | 平均分数减最高对手分数 |\n|---|---:|---:|---:|---:|---:|\n${table}\n\n合计 ${totals[i].wins}/${totals[i].games} 获得第一名（${pct(totals[i].winRate)}）；等强、座位对称时参考期望为 ${referenceWins} 次。候选累计模拟 ${samples.toLocaleString("en-US")} 次，未达到目标的步数截断 ${trunc} 次。\n`;
});
const costs = reports[0].costSummary;
const old = costs.find((r) => r.variant === "epoch32")!;
const next = costs.find((r) => r.variant === "next32")!;
const decision =
  totals[0].wins <= referenceWins
    ? "本次独立验证没有支持将跨纪元搜索设为默认；同模拟预算的第一名次数未超过等强参考期望。保留已实现的可选模式，正式进阶 AI 继续使用本纪元 32 次预算。"
    : totals[1].wins <= referenceWins
      ? "同模拟预算出现提升迹象，但对本纪元双倍预算没有体现足够的计算效率优势。保留已实现的可选模式，正式进阶 AI 继续使用本纪元 32 次预算。"
      : "两组对照均出现提升迹象；仍需结合独立种子数量与计算开销判断是否适合默认启用。本报告不自动更改产品默认设置。";
const bySeed = Array.from({ length: reports[0].seeds }, (_, n) => {
  const seed = reports[0].seedStart + n;
  return `| ${seed} | ${reports.map((r) => r.games.filter((g) => g.seed === seed && g.rank === 1).length).join(" | ")} |`;
}).join("\n");
const text = `# 跨纪元搜索验证\n\n日期：2026-10-25。\n\n${decision}\n\n## 实现与实验设计\n\nTS 与 C++ 均新增 \`horizon: "next-epoch"\`。每次模拟统一执行到下一纪元计分结束；从第二、第三纪元开始则直到终局。只改变模拟终点与相应的 480 步保护上限，保留原估值、对手模型、UCT、场景采样和默认每根候选 32 次预算。报告新增 \`truncated\`，用于识别没有到达指定终点的模拟。\n\n预先固定 ${reports[0].seedStart}–${reports[0].seedStart + reports[0].seeds - 1} 共 ${reports[0].seeds} 个验证种子，覆盖 2–5 人，候选轮换所有座位。两组各 ${totals[0].games} 局，合计 ${totals.reduce((v, r) => v + r.games, 0)} 局；没有依据验证结果改变参数。11001 起的试验种子未参与此次验证。每局行动交给正式 TS 引擎验证执行，排名按正式规则以最高圆盘打破同分。\n\n${sections.join("\n")}\n## 按独立牌序种子查看第一名次数\n\n| 种子 | 对本纪元 32 | 对本纪元 64 |\n|---|---:|---:|\n${bySeed}\n\n每个种子包含 14 局座位轮换，等强参考期望为 4 次第一名。共享一个种子的座位轮换存在相关性，84 局不能当成 84 个独立牌序；只有 6 个种子，不给出按独立对局假设计算的显著性或稳定真人胜率。两组对照同样共享种子，不合并成一个总体胜率。\n\n## 计算成本\n\n并发对战前，先对 24 个公开局面串行预热计时，覆盖 2–5 人与三个纪元，轮换执行顺序。\n\n| 模式 | 合计耗时 ms | 中位 ms | P95 ms | 截断模拟 |\n|---|---:|---:|---:|---:|\n${costs.map((r) => `| ${r.variant} | ${r.totalMs.toFixed(2)} | ${r.medianMs.toFixed(2)} | ${r.p95Ms.toFixed(2)} | ${r.truncated} |`).join("\n")}\n\n跨纪元 32 的合计耗时是本纪元 32 的 ${(next.totalMs / old.totalMs).toFixed(2)} 倍。第二组的本纪元 64 是耗时接近的额外对照，仍非逐手严格等时测试。并发对战内记录的耗时受到线程竞争影响，只作诊断，不用于延迟结论。\n\n## 复现与原始证据\n\n\`npm run benchmark:horizon -- --split validation --seeds 6 --jobs 3 --out artifacts/ai-next-epoch-validation.json\`\n\n\`npm run benchmark:horizon -- --split validation --seeds 6 --opponent-samples 64 --jobs 3 --costs off --out artifacts/ai-next-epoch-budget-control.json\`\n\n\`node --experimental-strip-types scripts/summarize-horizon.ts\`\n\n- 同预算逐局结果：[ai-next-epoch-validation.json](ai-next-epoch-validation.json)\n- 更多计算预算对照：[ai-next-epoch-budget-control.json](ai-next-epoch-budget-control.json)\n- C++ 源码 SHA-256：\`${reports[0].sourceSha256}\`\n- Wasm SHA-256：\`${reports[0].wasmSha256}\`\n`;
await writeFile("artifacts/ai-next-epoch-benchmark.md", text);
console.log(JSON.stringify({ decision, totals, referenceWins }, null, 2));
