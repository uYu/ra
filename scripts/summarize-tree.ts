import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
type Stats = {
  searched: number;
  searchMs: number;
  maxMs: number;
  overshootMs: number;
  overrunCalls: number;
  samples: number;
  nodes: number;
  outcomeReuses: number;
  depth: number;
  truncated: number;
};
type Game = {
  variant: "sh" | "dpw";
  mode: "fixed" | "time";
  count: number;
  seed: number;
  seat: number;
  rank: number;
  score: number;
  margin: number;
  stats: Record<"candidate" | "opponent", Stats>;
};
const file = process.argv[2] ?? "artifacts/ai-tree-validation.json";
const r = JSON.parse(await readFile(file, "utf8"));
assert.equal(r.status, "complete", "Only summarize the complete planned suite");
assert.equal(r.finishedGames, r.plannedGames);
assert.equal(r.games.length, r.plannedGames);
const { counts, variants, modes, seeds, start, config } = r.identity;
assert.deepEqual(counts, [2, 3, 4, 5]);
assert.deepEqual(variants, ["sh", "dpw"]);
assert.deepEqual(modes, ["fixed", "time"]);
assert.equal(seeds, 6);
assert.equal(start, 14001);
assert.equal(config.samples, 32);
assert.equal(config.timeMs, 200);
assert.equal(r.plannedGames, 336);
let manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
if (manifest.wasmSha256 !== r.identity.wasmSha256) {
  manifest = JSON.parse(
    await readFile("artifacts/frozen-uct3/wasm-build.json", "utf8"),
  );
  manifest.source = "artifacts/frozen-uct3/ra_ai.cpp";
  manifest.target = "artifacts/frozen-uct3/ra-ai.wasm";
}
assert.equal(manifest.sourceSha256, r.identity.sourceSha256);
assert.equal(manifest.wasmSha256, r.identity.wasmSha256);
for (const [path, expected] of [
  [manifest.source, manifest.sourceSha256],
  [manifest.target, manifest.wasmSha256],
])
  assert.equal(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    expected,
  );
const costSource = JSON.parse(await readFile(r.identity.costSource, "utf8"));
assert.equal(costSource.identity.wasmSha256, r.identity.wasmSha256);
assert.equal(costSource.identity.config.samples, config.samples);
assert.deepEqual(costSource.costs, r.costs);
const games: Game[] = r.games;
assert.equal(
  new Set(
    games.map((g) => `${g.variant}/${g.mode}/${g.count}/${g.seed}/${g.seat}`),
  ).size,
  games.length,
);
for (const variant of variants)
  for (const mode of modes)
    for (let seed = start; seed < start + seeds; seed++)
      for (const count of counts)
        for (let seat = 0; seat < count; seat++)
          assert.ok(
            games.some(
              (g) =>
                g.variant === variant &&
                g.mode === mode &&
                g.count === count &&
                g.seed === seed &&
                g.seat === seat,
            ),
          );
for (const g of games) {
  assert.ok(g.rank >= 1 && g.rank <= g.count);
  if (g.mode === "fixed") {
    assert.equal(g.stats.candidate.samples % config.samples, 0);
    assert.equal(g.stats.opponent.samples % config.samples, 0);
  }
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
// Resample whole seed blocks (all seats and player counts together), never
// assume that the 84 games in a group are independent Bernoulli trials.
function blockInterval(wins: number[], gamesPerSeed: number) {
  let sums = [0];
  for (let i = 0; i < wins.length; i++)
    sums = sums.flatMap((v) => wins.map((w) => v + w));
  sums.sort((a, b) => a - b);
  return [
    sums[Math.floor(sums.length * 0.025)],
    sums[Math.floor(sums.length * 0.975)],
  ].map((v) => v / (wins.length * gamesPerSeed));
}
const groups = (variants as string[]).flatMap((variant) =>
  (modes as string[]).map((mode) => {
    const rows = games.filter((g) => g.variant === variant && g.mode === mode);
    const bySeed = Array.from(
      { length: seeds },
      (_, n) => rows.filter((g) => g.seed === start + n && g.rank === 1).length,
    );
    const reference = seeds * counts.length;
    const sum = (side: "candidate" | "opponent", key: keyof Stats) =>
      rows.reduce((n, g) => n + g.stats[side][key], 0);
    return {
      variant,
      mode,
      rows,
      wins: rows.filter((g) => g.rank === 1).length,
      reference,
      bySeed,
      interval: blockInterval(
        bySeed,
        counts.reduce((a: number, b: number) => a + b, 0),
      ),
      candidateCalls: sum("candidate", "searched"),
      opponentCalls: sum("opponent", "searched"),
      candidateMs: sum("candidate", "searchMs"),
      opponentMs: sum("opponent", "searchMs"),
      candidateOverruns: sum("candidate", "overrunCalls"),
      opponentOverruns: sum("opponent", "overrunCalls"),
      candidateOvershoot: sum("candidate", "overshootMs"),
      opponentOvershoot: sum("opponent", "overshootMs"),
      reuses: sum("candidate", "outcomeReuses"),
      truncated: sum("candidate", "truncated"),
    };
  }),
);
const label = (variant: string, mode: string) =>
  `${mode === "time" && variant === "sh" ? "Anytime SH" : variant.toUpperCase()} / ${mode === "time" ? "200 ms" : "固定预算"}`;
const overview = groups
  .map(
    (g) =>
      `| ${label(g.variant, g.mode)} | ${g.wins}/84 | ${pct(g.wins / 84)} | 24/84 | ${g.bySeed.join(", ")} | ${g.interval.map(pct).join("–")} |`,
  )
  .join("\n");
const byCount = groups
  .map(
    (g) =>
      `| ${label(g.variant, g.mode)} | ${counts
        .map((count: number) => {
          const rows = g.rows.filter((r) => r.count === count);
          return `${rows.filter((r) => r.rank === 1).length}/${rows.length}`;
        })
        .join(" | ")} |`,
  )
  .join("\n");
const timing = groups
  .filter((g) => g.mode === "time")
  .map(
    (g) =>
      `| ${label(g.variant, g.mode)} | ${(g.candidateMs / g.candidateCalls).toFixed(2)} | ${(g.opponentMs / g.opponentCalls).toFixed(2)} | ${pct(g.candidateOverruns / g.candidateCalls)} | ${pct(g.opponentOverruns / g.opponentCalls)} |`,
  )
  .join("\n");
const costTable = r.costSummary
  .map(
    (c: any) =>
      `| ${c.variant.toUpperCase()} | ${c.totalMs.toFixed(2)} | ${c.medianMs.toFixed(2)} | ${c.p95Ms.toFixed(2)} | ${c.nodes} | ${c.meanDepth.toFixed(2)} | ${c.maxOutcomeBranches} | ${c.outcomeReuses} |`,
  )
  .join("\n");
const candidates = variants.filter((v: string) =>
  groups.filter((g) => g.variant === v).every((g) => g.wins > g.reference),
);
const signal = candidates.length
  ? `${candidates.map((s: string) => s.toUpperCase()).join("、")} 在固定预算和等时组的第一名次数均高于等强参考，值得继续关注；是否足以启用仍需结合人数分布、跨种子方向和区间，不把高于参考自动视为已证实提升。`
  : "没有一种方法在固定预算和等时两组都获得高于等强参考的第一名次数；本次结果不支持直接替换默认搜索。";
const text = `# SH / DPW 对照结果\n\n实验日期：2026-10-26。\n\n${signal}\n\n## 设计与完整性\n\n六个新种子 14001–14006，2–5 人全部座位，四组各 84 局，共 336 局全部完成。每局只有一个候选，其余为 UCT。估值、对手策略、收益函数、场景采样和单纪元终点保持一致。固定预算双方总模拟预算为根候选数 × 32 次，由各搜索策略分配；等时双方每步 200 ms 软时限。固定预算 SH 使用 Sequential Halving，等时 SH 使用 Anytime 调度，两者分别报告，不混为同一个测试配置。DPW 使用统一宽度 \`ceil(2 * sqrt(visits + 1))\`，根候选全部保留。\n\n参数、研究引用与信息隔离处理见 [实验设计](ai-tree-methods.md)。本报告脚本检查完整组别、种子、座位和无重复记录；所有行动经正式 TS 引擎验证执行，同分按最高圆盘判定。\n\n## 第一名次数\n\n| 候选 / 预算 | 第一名 | 比例 | 等强参考期望 | 各种子第一名次数 | 种子区组 bootstrap 95% 区间 |\n|---|---:|---:|---:|---|---|\n${overview}\n\n参考期望是假设等强、轮换座位对称时的数值，不是另外实测的旧版胜场。每个种子每组有 14 局，参考为 4 次第一名。区间用六个完整种子区组有放回重采样计算，保留座位、人数间的相关性；只有六个种子，区间仅作敏感性诊断，不能解释为稳定真人胜率。没有使用按 84 局独立假设计算的显著性。\n\n| 候选 / 预算 | 2 人 | 3 人 | 4 人 | 5 人 |\n|---|---:|---:|---:|---:|\n${byCount}\n\n不根据这些结果为单独的人数启用变体。\n\n## 等时预算是否生效\n\n下表仅计实际执行搜索的调用，排除只有一个合法候选而直接返回的步骤。统计包含 JS 输入处理和结果解码。\n\n| 组别 | 候选平均 ms | UCT 平均 ms | 候选超过 210 ms | UCT 超过 210 ms |\n|---|---:|---:|---:|---:|\n${timing}\n\n200 ms 为相同的软计算时限，在完整模拟间检查，并保证每个根候选至少评估一次。因此实际时间包括末次模拟、桥接与操作系统调度开销，不是严格相等的 CPU 时间。并发线程共用交错组别队列，减少组别与机器负载时段的相关性；时钟预算下的模拟次数和结果不能保证逐次完全重现。固定预算模式保持确定性。\n\n## 固定预算的串行成本与树结构\n\n24 个相同公开局面，覆盖 2–5 人及三个纪元，预热并轮换执行顺序。该测量在并发对战和测试前完成，来自 \`${r.identity.costSource}\`；只复用它的串行耗时与结构数据，校验了二进制和模拟预算一致，没有混入旧批次的胜负。\n\n| 算法 | 合计 ms | 中位 ms | P95 ms | 节点总数 | 平均最大深度 | 最大随机后续分支 | 结果复用次数 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${costTable}\n\n${groups.map((g) => `${label(g.variant, g.mode)}：候选结果复用 ${g.reuses.toLocaleString("en-US")} 次，步数上限截断 ${g.truncated} 次。`).join("\n\n")}\n\n## 原始记录与复现\n\n最初 40 ms 批次遵照用户提出的预算调整而中止，保留在 [ai-tree-40ms-stopped.json](ai-tree-40ms-stopped.json)，不用于本次棋力结论。200 ms 的全部逐局记录：[ai-tree-validation.json](ai-tree-validation.json)。\n\n\`npm run benchmark:tree -- --seeds 6 --start 14001 --time-ms 200 --jobs 8 --cost-source artifacts/ai-tree-40ms-stopped.json --out artifacts/ai-tree-validation.json\`\n\n已有同参数同二进制检查点时加 \`--resume yes\`；新的重复实验应选新的输出文件。\n\n\`node --experimental-strip-types scripts/summarize-tree.ts\`\n\n- 原生源码 SHA-256：\`${r.identity.sourceSha256}\`\n- Wasm SHA-256：\`${r.identity.wasmSha256}\`\n`;
await writeFile("artifacts/ai-tree-benchmark.md", text);
console.log(
  JSON.stringify(
    { signal, groups: groups.map(({ rows: _rows, ...g }) => g) },
    null,
    2,
  ),
);
