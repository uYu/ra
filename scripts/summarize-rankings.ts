import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
type Game = {
  count: number;
  seed: number;
  seat: number;
  rank: number;
  score: number;
  margin: number;
  variant?: string;
  mode?: string;
  replayPath?: string;
};
type Source = { file: string; sha256: string; raw: any; games: Game[] };
const sources = new Map<string, Source>();
async function read(file: string) {
  let r = sources.get(file);
  if (!r) {
    const bytes = await readFile("artifacts/" + file);
    const raw = JSON.parse(bytes.toString());
    r = {
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      raw,
      games: raw.games,
    };
    assert.ok(Array.isArray(r.games));
    for (const g of r.games) {
      assert.ok(Number.isInteger(g.rank) && g.rank >= 1 && g.rank <= g.count);
      assert.ok(Number.isInteger(g.seat) && g.seat >= 0 && g.seat < g.count);
      assert.ok(Number.isInteger(g.seed));
      assert.ok(Number.isInteger(g.count) && g.count >= 2 && g.count <= 5);
      assert.ok(Number.isFinite(g.score) && Number.isFinite(g.margin));
    }
    sources.set(file, r);
  }
  return r;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const rankScore = (g: Game) => (g.count - g.rank) / (g.count - 1);
for (const count of [2, 3, 4, 5])
  assert.ok(
    Math.abs(
      mean(
        Array.from({ length: count }, (_, i) => (count - i - 1) / (count - 1)),
      ) - 0.5,
    ) < 1e-12,
  );
function interval(blocks: number[], alpha = 0.05) {
  let draws = [0];
  for (let i = 0; i < blocks.length; i++)
    draws = draws.flatMap((x) => blocks.map((v) => x + v));
  draws.sort((a, b) => a - b);
  return [
    draws[Math.floor((draws.length * alpha) / 2)] / blocks.length,
    draws[
      Math.min(draws.length - 1, Math.floor(draws.length * (1 - alpha / 2)))
    ] / blocks.length,
  ];
}
function analyze(
  label: string,
  source: Source,
  rows: Game[],
  primary: boolean,
) {
  const counts = [...new Set(rows.map((g) => g.count))].sort((a, b) => a - b),
    seeds = [...new Set(rows.map((g) => g.seed))].sort((a, b) => a - b);
  assert.equal(
    new Set(rows.map((g) => `${g.count}/${g.seed}/${g.seat}`)).size,
    rows.length,
  );
  for (const seed of seeds)
    for (const count of counts) {
      const seats = rows
        .filter((g) => g.seed === seed && g.count === count)
        .map((g) => g.seat)
        .sort((a, b) => a - b);
      assert.deepEqual(
        seats,
        Array.from({ length: count }, (_, i) => i),
      );
    }
  if (primary) {
    assert.equal(source.raw.status, "complete");
    assert.equal(seeds.length, 6);
    assert.deepEqual(counts, [2, 3, 4, 5]);
    assert.equal(rows.length, 84);
    assert.equal(source.raw.finishedGames, source.raw.plannedGames);
    assert.equal(source.games.length, source.raw.plannedGames);
  }
  const byCount = counts.map((count) => {
    const gs = rows.filter((g) => g.count === count);
    return {
      count,
      games: gs.length,
      meanRank: mean(gs.map((g) => g.rank)),
      referenceMeanRank: (count + 1) / 2,
      rankDistribution: Array.from(
        { length: count },
        (_, i) => gs.filter((g) => g.rank === i + 1).length,
      ),
      normalizedRankScore: mean(gs.map(rankScore)),
      firstPlaces: gs.filter((g) => g.rank === 1).length,
      meanMargin: mean(gs.map((g) => g.margin)),
    };
  });
  const blocks = seeds.map((seed) => {
    const gs = rows.filter((g) => g.seed === seed);
    return {
      seed,
      balancedRankScore: mean(
        counts.map((count) =>
          mean(gs.filter((g) => g.count === count).map(rankScore)),
        ),
      ),
      gameWeightedRankScore: mean(gs.map(rankScore)),
      rankImprovement: mean(gs.map((g) => (g.count + 1) / 2 - g.rank)),
    };
  });
  const output = {
    label,
    file: source.file,
    sourceSha256: source.sha256,
    games: rows.length,
    counts,
    seeds,
    firstPlaces: rows.filter((g) => g.rank === 1).length,
    referenceFirstPlaces: seeds.length * counts.length,
    meanRank: mean(rows.map((g) => g.rank)),
    referenceMeanRank: mean(rows.map((g) => (g.count + 1) / 2)),
    balancedRankScore: mean(byCount.map((g) => g.normalizedRankScore)),
    gameWeightedRankScore: mean(rows.map(rankScore)),
    byCount,
    bySeed: blocks,
    interval95: primary
      ? interval(blocks.map((b) => b.balancedRankScore))
      : null,
    intervalFamily9: primary
      ? interval(
          blocks.map((b) => b.balancedRankScore),
          0.05 / 9,
        )
      : null,
    rankImprovement95: primary
      ? interval(blocks.map((b) => b.rankImprovement))
      : null,
    completeReplays: rows.filter((g) => Boolean(g.replayPath)).length,
  };
  assert.ok(
    Math.abs(
      output.balancedRankScore - mean(blocks.map((b) => b.balancedRankScore)),
    ) < 1e-12,
  );
  return output;
}
const primary = [];
for (const [file, label] of [
  ["ai-next-epoch-validation.json", "跨纪元×32 vs 本纪元×32"],
  ["ai-next-epoch-budget-control.json", "跨纪元×32 vs 本纪元×64"],
] as const) {
  const s = await read(file);
  primary.push(analyze(label, s, s.games, true));
}
const tree = await read("ai-tree-validation.json");
for (const variant of ["sh", "dpw"])
  for (const mode of ["fixed", "time"])
    primary.push(
      analyze(
        `${variant === "sh" ? (mode === "time" ? "Anytime SH" : "SH") : "DPW"} / ${mode === "time" ? "双方200 ms" : "双方固定×32"}`,
        tree,
        tree.games.filter((g) => g.variant === variant && g.mode === mode),
        true,
      ),
    );
for (const [file, label] of [
  ["ai-uct200-control.json", "UCT200 ms vs UCT固定×32"],
  ["ai-value-validation.json", "学习估值 vs 原估值 / 双方200 ms"],
  ["ai-policy-validation.json", "学习续局 vs 原续局 / 双方200 ms"],
] as const) {
  const s = await read(file);
  primary.push(analyze(label, s, s.games, true));
}
const archive = [];
for (const [file, label] of [
  ["ai-guided-mcts-vs-mcts.json", "早期策略引导MCTS vs 当时MCTS"],
  ["ai-mcts-vs-previous.json", "早期MCTS vs previous"],
  ["ai-standard-vs-legacy.json", "早期标准策略 vs legacy"],
  ["ai-vs-legacy.json", "早期候选（文件未标版本）vs legacy"],
  ["ai-vs-policy.json", "早期候选（文件未标版本）vs policy"],
  ["ai-wasm-search-budget.json", "Wasm×96 vs Wasm×32（仅3/5人）"],
] as const) {
  const s = await read(file);
  archive.push(analyze(label, s, s.games, false));
}
const excluded = [];
for (const [file, reason] of [
  ["ai-tree-40ms-stopped.json", "中途停止，58局不构成完整均衡组"],
  ["ai-guided-mcts-pilot.json", "调试/先导样本，不作为独立最终验证"],
  ["ai-pilot.json", "先导样本，且未轮换全部座位"],
] as const) {
  const s = await read(file);
  excluded.push({ file, games: s.games.length, reason, sha256: s.sha256 });
}
const output = {
  description:
    "Retrospective rank reanalysis; raw experiment results untouched. Rank score=(players-rank)/(players-1), equal-strength50%. Primary aggregate averages player counts equally; game-weighted alternative also reported. Whole-seed percentile bootstrap, six seeds. Family9 interval uses alpha=.05/9 as sensitivity only; does not undo post-hoc metric selection.",
  primary,
  archive,
  excluded,
  inventory: [...sources.values()].map((s) => ({
    file: s.file,
    games: s.games.length,
    status: s.raw.status ?? "legacy record",
    sha256: s.sha256,
    fields:
      "count,seed,seat,rank,score,margin; some newer files also contain stats/replayPath",
  })),
};
await writeFile(
  "artifacts/ai-ranking-summary.json",
  JSON.stringify(output, null, 2),
);
const pct = (v: number) => (100 * v).toFixed(1) + "%",
  f = (v: number) => v.toFixed(2),
  ci = (v: number[] | null) => (v ? v.map(pct).join("–") : "—");
const sh = primary.find((g) => g.label.startsWith("Anytime SH"))!,
  policy = primary.at(-1)!;
const text = `# 历史实验按排名重新分析

逐局结果一直保留：人数、种子、被测座位、最终排名、分数、对最强对手的分差。较新的文件还有搜索统计。**早期逐局统计不等于逐步棋谱**：旧实验没有保存每步行动，不能还原计时搜索；最新学习续局实验的80局训练/开发和84局最终对局保存了完整行动记录。

本报告直接重算现有结果，没有重跑对局，没有改变原始JSON；以下数量不含教师训练对局与另录的诊断对局。共读取${[...sources.values()].reduce((n, s) => n + s.games.length, 0)}条逐局结果；主要完整验证9组、共${primary.reduce((n, g) => n + g.games, 0)}局；早期档案${archive.reduce((n, g) => n + g.games, 0)}局；先导或中止的${excluded.reduce((n, g) => n + g.games, 0)}局仅列存档，不用于主要结论。

## 排名口径

- 分人数报告平均名次，越低越好；等强参考分别为两人1.50、三人2.00、四人2.50、五人3.00。
- 跨人数排名得分 = (人数 − 名次)/(人数 − 1)：首名100%，末名0%，等强参考50%。它表示排在后面的对手比例，不是另行实测的单挑胜率。
- 主汇总先对每个人数求均值，再让2/3/4/5人四组等权。另列对局加权口径，避免座位轮换让五人组局数较多而隐藏加权选择。
- 第一名次数继续保留为辅助指标。总体原始平均名次也可算，但会受人数分布影响，所以不单凭它比较强弱。

## 主要完整实验：平均名次

| 方案（相对各自实验中的对手） | 2人 | 3人 | 4人 | 5人 | 排名得分：人数等权 | 对局加权 | 首名 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 等强参考 | 1.50 | 2.00 | 2.50 | 3.00 | 50.0% | 50.0% | 24/84 |
${primary.map((g) => `| ${g.label} | ${[2, 3, 4, 5].map((n) => f(g.byCount.find((c) => c.count === n)!.meanRank)).join(" | ")} | ${pct(g.balancedRankScore)} | ${pct(g.gameWeightedRankScore)} | ${g.firstPlaces}/84 |`).join("\n")}

这些方案的对手、预算和种子不完全相同，**该表不是所有算法互相交手的排行榜**。不同实验只应先对照各自的50%等强参考；不能由分数高低直接推出彼此胜负。

## 种子区组不确定性

按六个完整种子块重采样，保留同种子的所有人数与座位。下表的95%为单组区间；同时查看9组的Bonferroni区间作为多重比较敏感性检查。只有6个独立种子，两类区间都不应当作精确证明。排名指标也是事后重算，校正不能消除事后选指标的影响。

| 方案 | 人数等权排名得分 | 单组95%区间 | 九组比较校正区间 |
|---|---:|---:|---:|
${primary.map((g) => `| ${g.label} | ${pct(g.balancedRankScore)} | ${ci(g.interval95)} | ${ci(g.intervalFamily9)} |`).join("\n")}

## 重新判断

1. **Anytime SH / 200 ms 应重新列为优先复测对象。** 排名得分${pct(sh.balancedRankScore)}，单组95%区间${ci(sh.interval95)}；两人、三人、五人平均排名都优于等强参考，四人略低于参考。只看27/84次首名确实漏掉了改善名次的信息。九组比较校正区间为${ci(sh.intervalFamily9)}，仍包含50%，不足以直接宣布已稳定更强。
2. **最新学习续局模型有较温和的正向信号。** 得分${pct(policy.balancedRankScore)}，区间${ci(policy.interval95)}；三人局平均名次1.72对等强参考2.00，五人2.90对3.00，两人和四人恰好等强参考。不是“完全没有改善”，但尚未排除种子波动。
3. 学习估值在三人、五人排名有改善，但两人明显较差；人数等权得分47.8%，对局加权50.8%。因此不宜仅凭混合人数的原始平均名次2.33优于参考2.43，就宣称整体更强。
4. 跨纪元32对本纪元64的排名表现明显较弱；改用排名也不支持启用该配置。其他方案详见表中完整人数结果。

**此前结论应限定为“首名指标没有证实稳定优势”，不能扩展成“所有方案都没有排名收益”。** 用户选择排名作为主要目标后，今后的验证应预先以分人数平均名次/归一化排名为主要指标，首名和分差为辅助。推荐先用新种子确认Anytime SH的排名信号，不用原有种子重复调参；本次不更改默认算法。

## 完整名次分布

| 方案 | 人数 | 各名次数量（第一到末名） | 平均名次 | 等强参考 |
|---|---:|---|---:|---:|
${primary.flatMap((g) => g.byCount.map((c) => `| ${g.label} | ${c.count} | ${c.rankDistribution.join(", ")} | ${f(c.meanRank)} | ${f(c.referenceMeanRank)} |`)).join("\n")}

## 早期实验档案

以下对手版本与近期不同，且仅1–4个种子，作为历史描述，不与上述九组混排，也不报告看似精确的小样本区间。

| 记录 | 局数 / 种子数 | 人数 | 对应人数平均名次 | 人数等权排名得分 | 原始结果 |
|---|---|---|---|---:|---|
${archive.map((g) => `| ${g.label} | ${g.games} / ${g.seeds.length} | ${g.counts.join(", ")} | ${g.byCount.map((c) => f(c.meanRank)).join(", ")} | ${pct(g.balancedRankScore)} | [JSON](${g.file}) |`).join("\n")}

## 所有原始逐局结果的保存位置

| 文件 | 逐局数量 | 状态 |
|---|---:|---|
${[...sources.values()].map((s) => `| [${s.file}](${s.file}) | ${s.games.length} | ${s.raw.status ?? (s.file.includes("pilot") ? "pilot" : "早期已存记录")} |`).join("\n")}

不纳入主要结论的记录：${excluded.map((e) => `${e.file}：${e.reason}`).join("；")}。

机器可读汇总、完整每名次数量、按种子数据和原始文件SHA-256见 [ai-ranking-summary.json](ai-ranking-summary.json)。复现：node --experimental-strip-types scripts/summarize-rankings.ts。
`;
await writeFile("artifacts/ai-ranking-benchmark.md", text);
console.log(
  JSON.stringify(
    {
      primary: primary.map((g) => ({
        label: g.label,
        meanRanks: g.byCount.map((c) => c.meanRank),
        rankScore: g.balancedRankScore,
        interval: g.interval95,
        family9: g.intervalFamily9,
      })),
      totalSavedResults: output.inventory.reduce((n, s) => n + s.games, 0),
    },
    null,
    2,
  ),
);
