import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSave, replay } from "../src/game/storage.ts";
import { ranking } from "../src/game/engine.ts";
const sha = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
const result = JSON.parse(
    await readFile("artifacts/ai-policy-validation.json", "utf8"),
  ),
  training = JSON.parse(
    await readFile("artifacts/ai-policy-training.json", "utf8"),
  );
assert.equal(result.status, "complete");
assert.equal(result.finishedGames, 84);
assert.equal(result.plannedGames, 84);
assert.equal(result.games.length, 84);
assert.equal(result.identity.start, 71001);
assert.equal(result.identity.seeds, 6);
assert.deepEqual(result.identity.counts, [2, 3, 4, 5]);
assert.deepEqual(result.identity.variants, ["uct"]);
assert.deepEqual(result.identity.modes, ["time"]);
assert.equal(result.identity.config.timeMs, 200);
assert.equal(result.identity.config.samples, 32);
assert.equal(result.identity.config.opponentFixed, undefined);
assert.equal(result.identity.config.valueModel, undefined);
assert.equal(result.identity.rolloutModelSha256, training.modelSha256);
assert.equal(
  sha(await readFile("artifacts/ai-rollout-model.json")),
  training.modelSha256,
);
assert.equal(
  sha(await readFile("artifacts/ai-policy-dataset.json")),
  training.datasetSha256,
);
const manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
assert.equal(result.identity.sourceSha256, manifest.sourceSha256);
assert.equal(result.identity.wasmSha256, manifest.wasmSha256);
assert.equal(sha(await readFile(manifest.source)), manifest.sourceSha256);
assert.equal(sha(await readFile(manifest.target)), manifest.wasmSha256);
const teacherManifest = JSON.parse(
  await readFile("artifacts/frozen-uct4/wasm-build.json", "utf8"),
);
assert.equal(
  sha(await readFile("artifacts/frozen-uct4/ra_ai.cpp")),
  teacherManifest.sourceSha256,
);
assert.equal(
  sha(await readFile("artifacts/frozen-uct4/ra-ai.wasm")),
  teacherManifest.wasmSha256,
);
assert.equal(training.teacher.wasmSha256, teacherManifest.wasmSha256);
const dataset = JSON.parse(
  await readFile("artifacts/ai-policy-dataset.json", "utf8"),
);
assert.equal(dataset.games.length, 80);
assert.equal(new Set(dataset.games.map((g: any) => g.seed)).size, 80);
const coverage = { train: [0, 0, 0, 0], dev: [0, 0, 0, 0] };
for (const g of dataset.games) {
  if (g.split === "train") assert.ok(g.seed >= 500001 && g.seed <= 500064);
  else {
    assert.equal(g.split, "dev");
    assert.ok(g.seed >= 600001 && g.seed <= 600016);
  }
  const raw = await readFile(g.path, "utf8");
  assert.equal(sha(raw), g.sha256);
  const trace = JSON.parse(raw),
    restored = replay(parseSave(raw));
  assert.equal(
    trace.audit.metadata.build.wasmSha256,
    teacherManifest.wasmSha256,
  );
  assert.equal(
    trace.audit.metadata.build.sourceSha256,
    teacherManifest.sourceSha256,
  );
  assert.equal(restored.phase, "over");
  assert.equal(trace.audit.decisions.length, trace.actions.length);
  assert.equal(trace.audit.actionsSha256, sha(JSON.stringify(trace.actions)));
  assert.deepEqual(ranking(restored), trace.audit.ranking);
  coverage[g.split as "train" | "dev"][restored.players.length - 2]++;
  for (const r of g.rows) {
    assert.equal(r.base.length, 263);
    assert.equal(r.actions.length, r.target.length);
    assert.ok(
      Math.abs(r.target.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-10,
    );
    assert.ok(r.actions.every((a: number[]) => a.length === 24));
  }
}
assert.deepEqual(coverage, { train: [16, 16, 16, 16], dev: [4, 4, 4, 4] });
const seen = new Set();
let savedDecisions = 0;
for (let seed = 71001; seed <= 71006; seed++)
  for (const count of [2, 3, 4, 5])
    for (let seat = 0; seat < count; seat++)
      assert.equal(
        result.games.filter(
          (g: any) => g.seed === seed && g.count === count && g.seat === seat,
        ).length,
        1,
      );
for (const g of result.games) {
  const key = `${g.seed}/${g.count}/${g.seat}`;
  assert.ok(!seen.has(key));
  seen.add(key);
  const raw = await readFile(g.replayPath, "utf8"),
    trace = JSON.parse(raw),
    restored = replay(parseSave(raw)),
    ranks = ranking(restored);
  assert.equal(restored.phase, "over");
  assert.equal(restored.history.length, 3);
  assert.equal(restored.steps, g.steps);
  assert.equal(trace.audit.decisions.length, g.steps);
  assert.equal(trace.audit.metadata.rolloutModelSha256, training.modelSha256);
  assert.equal(trace.audit.actionsSha256, sha(JSON.stringify(trace.actions)));
  assert.equal(ranks.findIndex((p) => p.player === g.seat) + 1, g.rank);
  assert.equal(restored.players[g.seat].score, g.score);
  savedDecisions += g.steps;
}
const wins = result.games.filter((g: any) => g.rank === 1).length,
  bySeed = Array.from(
    { length: 6 },
    (_, i) =>
      result.games.filter((g: any) => g.seed === 71001 + i && g.rank === 1)
        .length,
  );
let sums = [0];
for (let i = 0; i < 6; i++)
  sums = sums.flatMap((v) => bySeed.map((w) => v + w));
sums.sort((a, b) => a - b);
const interval = [
  sums[Math.floor(sums.length * 0.025)] / 84,
  sums[Math.floor(sums.length * 0.975)] / 84,
];
const byCount = [2, 3, 4, 5].map((count) => {
  const rows = result.games.filter((g: any) => g.count === count);
  return {
    count,
    games: rows.length,
    wins: rows.filter((g: any) => g.rank === 1).length,
    meanRank: rows.reduce((v: number, g: any) => v + g.rank, 0) / rows.length,
    meanMargin:
      rows.reduce((v: number, g: any) => v + g.margin, 0) / rows.length,
  };
});
const sides = ["candidate", "opponent"].map((side) => {
  const sum = (key: string) =>
      result.games.reduce((v: number, g: any) => v + g.stats[side][key], 0),
    searched = sum("searched");
  return {
    side,
    searched,
    meanSearchMs: sum("searchMs") / searched,
    samplesPerSearch: sum("samples") / searched,
    transitionsPerSearch: sum("transitions") / searched,
    truncated: sum("truncated"),
    over210ms: sum("overrunCalls"),
  };
});
const summary = {
  wins,
  games: 84,
  referenceWins: 24,
  bySeed,
  interval,
  byCount,
  sides,
  verifiedTeacherGames: 80,
  verifiedValidationReplays: 84,
  savedValidationDecisions: savedDecisions,
  development: training.dev,
  modelSha256: training.modelSha256,
  defaultChanged: false,
};
await writeFile(
  "artifacts/ai-policy-summary.json",
  JSON.stringify(summary, null, 2),
);
const pct = (v: number) => (100 * v).toFixed(1) + "%",
  f = (v: number) => v.toFixed(2);
const conclusion =
  interval[0] <= 24 / 84 && interval[1] >= 24 / 84
    ? "这轮未显示稳定优势，默认继续使用原续局策略。"
    : interval[1] < 24 / 84
      ? "这轮表现低于等强参考，不启用默认续局策略。"
      : "这轮显示优势信号，但仅6个独立种子，仍需扩展验证；默认暂保留原策略。";
const text = `# 学习续局策略实验结果

${conclusion} 本轮只替换模拟中的行动策略，末端仍使用原估值，没有重训价值网络。

## 训练与模仿效果

冻结原UCT、每次200 ms，64局训练、16局开发；所有座位与胜负全部纳入。${training.trainDecisions}个训练决策、${training.devDecisions}个开发决策。287→16tanh→1候选评分，共4625参数。训练和最终对局种子独立。按开发交叉熵选第${training.selectedEpoch + 1}轮checkpoint，最终验证前冻结模型。

开发集行动一致率：模型 **${pct(training.dev.accuracy)}**，原启发式 **${pct(training.dev.baselineAccuracy)}**。KL(教师访问分布||模型)为${f(training.dev.kl)}；模仿指标不能代替棋力。

| 阶段 | 开发决策数 | 模型一致率 | 原启发式一致率 |
|---|---:|---:|---:|
${training.byPhase.map((r: any) => `| ${r.phase} | ${r.n} | ${pct(r.accuracy)} | ${pct(r.baselineAccuracy)} |`).join("\n")}

改善主要来自普通回合的抽牌/发起拍卖选择；竞价模仿尚无改善。god阶段仅2个开发样本，不能据此推断泛化。灾难沿用现有单候选处理，不参与多候选分类训练。

## 独立完整对局

双方200 ms，学习续局UCT对原续局UCT；种子71001–71006、2–5人、全部座位，共84局。

被测玩家第一名 **${wins}/84 (${pct(wins / 84)})**；等强参考24/84 (28.6%)。按整个种子块bootstrap的95%区间 **${interval.map(pct).join("–")}**。每种子第一名数：${bySeed.join(", ")}。

| 人数 | 第一名 | 等强参考 | 平均排名 | 对最强对手平均分差 |
|---|---:|---:|---:|---:|
${byCount.map((r) => `| ${r.count} | ${r.wins}/${r.games} | 6/${r.games} | ${f(r.meanRank)} | ${f(r.meanMargin)} |`).join("\n")}

${sides.map((r) => `${r.side}：${r.searched}个需要搜索的决策，平均${f(r.meanSearchMs)} ms，平均${f(r.samplesPerSearch)}次模拟、${f(r.transitionsPerSearch)}次状态推进；截断${r.truncated}次，超过210 ms ${r.over210ms}次。`).join("\n\n")}

这些为并行对局的实际统计，不能把不同局面的模拟数之比直接当作模型的纯速度差。200 ms为软截止，最低候选覆盖和最后一次模拟可超时。

## 记录与可复现性

训练80局和最终84局的存档均已校验SHA并通过现有游戏导入器完整回放。最终对局共保存${savedDecisions}步行动及搜索报告。原始对局清单见 [ai-policy-validation.json](ai-policy-validation.json)，每局replayPath指向可导入棋谱；教师存档位于policy-teacher/。

模型SHA-256：${training.modelSha256}。模型文件ai-rollout-model.json，训练记录ai-policy-training.json，协议见 [ai-policy-methods.md](ai-policy-methods.md)。教师二进制/源码冻结于frozen-uct4/；生产Wasm ABI5支持按调用传入rolloutModel，未提供时固定预算结果复现冻结版本。

## 局限

只有64个训练游戏、16个开发游戏和6个独立最终种子。来自同局的决策相关，不能把2万多个决策当作独立游戏样本；84个座位轮换结果也不是84个独立随机种子。教师本身不是已知最优策略。低误差的模仿可能改善某些回合但损伤关键竞价；完整对局是本轮主要强度依据。本实验没有继续使用最终结果调模型、筛阶段或改变估值。
`;
await writeFile("artifacts/ai-policy-benchmark.md", text);
console.log(JSON.stringify(summary, null, 2));
