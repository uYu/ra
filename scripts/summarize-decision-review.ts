import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const review = JSON.parse(
  await readFile("artifacts/decision-analysis.json", "utf8"),
);
const decomposition = JSON.parse(
  await readFile("artifacts/decision-decomposition.json", "utf8"),
);
const strong = JSON.parse(
  await readFile("artifacts/decision-strong-continuation.json", "utf8"),
);
const index = JSON.parse(
  await readFile("artifacts/decision-replay-index.json", "utf8"),
);
assert.equal(index.results.length, 4);
assert.equal(review.cases.length, 8);
assert.equal(review.screenedDecisions, 267);
assert.equal(decomposition.case.path, strong.case.path);
assert.equal(decomposition.case.step, strong.case.step);
for (const useModel of [false, true]) {
  const rows = strong.rows.filter((r: any) => r.useModel === useModel);
  assert.equal(rows.length, 128);
  assert.equal(new Set(rows.map((r: any) => r.index)).size, 128);
  const summary = strong.summaries.find((r: any) => r.useModel === useModel);
  assert.equal(
    summary.mean,
    rows.reduce((v: number, r: any) => v + r.difference, 0) / 128,
  );
}
const fmt = (x: number) => x.toFixed(2),
  ci = (r: any) => `${fmt(r.mean)} [${fmt(r.low95)}, ${fmt(r.high95)}]`;
const selected = review.cases.find(
  (r: any) =>
    r.job.path === strong.case.path && r.job.step === strong.case.step,
);
const confirmed = strong.summaries.every((r: any) => r.low95 > 0);
const report = `# 对局记录与决策复盘结论

**原 168 局未保存逐步棋谱，只保留种子、结果和搜索统计。这是记录遗漏，计时搜索不能仅凭种子精确还原。** 已另行重跑、录制四局，并补齐以后基准实验的默认逐步记录。新棋谱均通过实际规则引擎完整回放核验。

本轮没有得到可以断言“这一步确定走错”的证据。最明显的疑点通过了三种启发式续局复核，但扩大到搜索型续局后未得到支持。不能把启发式复盘估计的收益当作实战确定丢分。

## 已保存的新棋谱

这些案例按原实验中两人/五人各自最差分差选取，适合诊断，不代表总体错误率。同一个种子重跑后的决策和成绩会变化。

| 实验 / 人数 / 种子 / 被测座位 | 原记录排名 / 分差 | 新录制排名 / 分差 | 棋谱 |
|---|---|---|---|
${index.results
  .map((r: any) => {
    const rank = r.ranking.findIndex((p: any) => p.player === r.seat) + 1;
    const own = r.ranking.find((p: any) => p.player === r.seat).score;
    const rival = Math.max(
      ...r.ranking
        .filter((p: any) => p.player !== r.seat)
        .map((p: any) => p.score),
    );
    return `| ${r.study} / ${r.count} / ${r.seed} / ${r.seat + 1} | ${r.originalRank} / ${r.originalMargin} | ${rank} / ${own - rival} | [导入回放](../${r.path}) |`;
  })
  .join("\n")}

存档是现有游戏兼容的 version 1 格式，可通过游戏导入。除全部行动外，还保存了每步玩家、纪元、阶段、实际耗时、模拟数及根候选访问/估值。以后 benchmark-tree 和 benchmark-budget-control 会把棋谱写到输出文件名加 .replays/ 的目录，汇总结果中的 replayPath 指向各棋谱；也可用 --replay-dir 指定目录。汇总中的历史 168 局不会被伪造补写。

## 第 98 步：最值得怀疑，但尚不能判错

新录制学习估值两人局，种子 40001，第 2 纪元第 98 步：拉美西斯只剩可用圆盘 3；对手只剩圆盘 1，且由对手主动发起拍卖。市场为尼罗河、圣祠，中央圆盘为 7。

实际出价 3，会换回 7，但本纪元自己的可用圆盘归零。若弃权，对手在本次主动拍卖中被迫出价 1，自己的 3 号盘仍可留给后续机会。这里存在当前藏品/下一纪元圆盘与本纪元后续行动权的权衡，不能单看买到哪些牌。

原决策进行了 ${selected ? JSON.parse(await readFile(selected.job.path, "utf8")).audit.decisions[selected.job.step - 1].report.samples : "?"} 次模拟，仍选出价 3。三个固定预算（每根候选 32、128、512）下，原估值与学习估值搜到本纪元均选出价 3；模拟到终局则均改为弃权。

从 267 个多候选决策初筛后，对每局两处疑点做独立复核。第 98 步在三种启发式续局中，“弃权相对于出价 3”的终局相对得分改善为：

| 续局策略 | 配对牌序数 | 预计改善及逐项 95% 区间 |
|---|---:|---:|
| 标准启发式 | ${selected.confirmation.n} | ${ci(selected.confirmation)} |
| 激进启发式 | ${selected.aggressive.n} | ${ci(selected.aggressive)} |
| 保守启发式 | ${selected.conservative.n} | ${ci(selected.conservative)} |

但搜索型续局没有确认这个优势：

| 后续均用固定 UCT ×32 | 配对牌序数 | 预计改善及 95% 区间 |
|---|---:|---:|
${strong.summaries.map((r: any) => `| ${r.useModel ? "被测玩家用学习估值，其他玩家用原估值" : "所有玩家用原估值"} | ${r.n} | ${ci(r)} |`).join("\n")}

两个区间都包含零，均值甚至略偏向实际的出价 3。因此该步**不能认定为已确认的错误**。这些续局本身也不是最优策略证明；128 组样本仍可能漏掉较小差异。

## 可以定位到什么问题

另用 256 组独立配对牌序，保持同一启发式续局，拆开本纪元得分、末端估值和真实终局结果。以下均为“弃权 − 出价 3”的相对收益，正数支持弃权：

| 比较口径 | 预计差异及 95% 区间 |
|---|---:|
| 只看本纪元已结算收益 | ${ci(decomposition.decomposition.current)} |
| 加原版剩余价值估计 | ${ci(decomposition.decomposition.old)} |
| 加学习模型剩余价值估计 | ${ci(decomposition.decomposition.learned)} |
| 真的按同一启发式继续到终局 | ${ci(decomposition.decomposition.final)} |

这证实了在指定启发式续局下，纪元边界的剩余估值把行动排序翻转了；学习模型也没有修正该例。但是换成搜索型续局，真实结果的排序又变化。因此更准确的诊断是：**末端估值、rollout 续局和实际搜索型玩家之间存在策略不匹配；目前不能把问题只归咎于某个出价、模型或搜索深度。**

这也解释了为什么“多算一些”不一定解决问题：在同一个近似估值体系内增加模拟，能减少采样噪声，却不能自动修正续局假设的偏差。这里只是局部诊断，不能由四局推断所有失败的原因。

其余 7 个初筛疑点未获三种启发式续局的一致确认，未继续宣称错棋。详细步骤见 [八处疑点与局面](decision-analysis.md)，完整数值见 decision-analysis.json、decision-decomposition.json、decision-strong-continuation.json。

## 后续改进依据

优先统一训练标签与实际搜索型续局，在这些行动排序有争议的局面上收集更多对照数据，再用独立种子检验；目前不应凭这个案例加入特定牌或特定圆盘的硬编码规则，也不应直接把所有局面改成终局搜索。

本次校验：新增棋谱存取/精确回放测试通过；两套基准引擎各完成两局低预算记录冒烟测试，四份存档均通过现有导入器回放；新分析脚本的 TypeScript 检查通过。原生产规则和 AI 算法未改动。
`;
await writeFile("artifacts/decision-review.md", report);
await writeFile(
  "artifacts/decision-review-summary.json",
  JSON.stringify(
    {
      originalActionHistoriesSaved: false,
      newRecordedGames: 4,
      screenedDecisions: 267,
      initiallySuspicious: 8,
      heuristicRobustCase: { step: strong.case.step, path: strong.case.path },
      strongPolicyConfirmed: confirmed,
      strongPolicySummaries: strong.summaries,
      conclusion:
        "No confidently identified wrong move in the targeted strong-policy check; demonstrated continuation/evaluator sensitivity and added complete future recording.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    recordedGames: index.results.length,
    strongPolicyConfirmed: confirmed,
    summaries: strong.summaries,
  }),
);
