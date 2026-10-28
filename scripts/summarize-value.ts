import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const control = JSON.parse(
  await readFile("artifacts/ai-uct200-control.json", "utf8"),
);
const value = JSON.parse(
  await readFile("artifacts/ai-value-validation.json", "utf8"),
);
const training = JSON.parse(
  await readFile("artifacts/ai-value-training.json", "utf8"),
);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
assert.equal(
  value.identity.modelSha256,
  hash(await readFile("artifacts/ai-value-model.json", "utf8")),
);
assert.equal(training.modelSha256, value.identity.modelSha256);
assert.equal(
  training.datasetSha256,
  createHash("sha256")
    .update(await readFile("artifacts/ai-value-dataset.json"))
    .digest("hex"),
);
for (const [r, base, source, target] of [
  [
    control,
    "artifacts/frozen-uct3/wasm-build.json",
    "artifacts/frozen-uct3/ra_ai.cpp",
    "artifacts/frozen-uct3/ra-ai.wasm",
  ],
  [
    value,
    "artifacts/frozen-uct4/wasm-build.json",
    "artifacts/frozen-uct4/ra_ai.cpp",
    "artifacts/frozen-uct4/ra-ai.wasm",
  ],
] as const) {
  const m = JSON.parse(await readFile(base, "utf8"));
  for (const [file, expected] of [
    [source, m.sourceSha256],
    [target, m.wasmSha256],
  ])
    assert.equal(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
      expected,
    );
  assert.equal(r.identity.sourceSha256, m.sourceSha256);
  assert.equal(r.identity.wasmSha256, m.wasmSha256);
  assert.deepEqual(r.identity.variants, ["uct"]);
  assert.deepEqual(r.identity.modes, ["time"]);
}
const pct = (n: number) => (100 * n).toFixed(1) + "%";
const summaries = [control, value].map((r, index) => {
  assert.equal(r.status, "complete");
  assert.equal(r.games.length, 84);
  assert.equal(r.plannedGames, 84);
  assert.equal(r.finishedGames, 84);
  assert.equal(r.identity.seeds, 6);
  assert.equal(r.identity.start, index === 0 ? 15001 : 40001);
  assert.deepEqual(r.identity.counts, [2, 3, 4, 5]);
  assert.equal(r.identity.config.timeMs, 200);
  assert.equal(r.identity.config.samples, 32);
  assert.equal(Boolean(r.identity.config.opponentFixed), index === 0);
  const seen = new Set();
  for (let seed = r.identity.start; seed < r.identity.start + 6; seed++)
    for (const count of [2, 3, 4, 5])
      for (let seat = 0; seat < count; seat++) {
        const rows = r.games.filter(
          (g: any) => g.seed === seed && g.count === count && g.seat === seat,
        );
        assert.equal(rows.length, 1);
        seen.add(`${seed}/${count}/${seat}`);
      }
  assert.equal(seen.size, 84);
  const wins = r.games.filter((g: any) => g.rank === 1).length;
  const bySeed = Array.from(
    { length: 6 },
    (_, i) =>
      r.games.filter(
        (g: any) => g.seed === r.identity.start + i && g.rank === 1,
      ).length,
  );
  let sums = [0];
  for (let i = 0; i < 6; i++)
    sums = sums.flatMap((v) => bySeed.map((w) => v + w));
  sums.sort((a, b) => a - b);
  const interval = [
    sums[Math.floor(sums.length * 0.025)] / 84,
    sums[Math.floor(sums.length * 0.975)] / 84,
  ];
  const sides = ["candidate", "opponent"].map((side) => {
    const sum = (key: string) =>
        r.games.reduce((n: number, g: any) => n + g.stats[side][key], 0),
      calls = sum("searched");
    return {
      side,
      searched: calls,
      meanSearchMs: sum("searchMs") / calls,
      samplesPerSearch: sum("samples") / calls,
      transitionsPerSearch: sum("transitions") / calls,
      over210: sum("overrunCalls"),
      truncated: sum("truncated"),
    };
  });
  return {
    label:
      index === 0
        ? "UCT 200 ms vs UCT ×32"
        : "学习估值 200 ms vs 原估值 200 ms",
    wins,
    games: 84,
    bySeed,
    interval,
    sides,
    meanRank: r.games.reduce((v: number, g: any) => v + g.rank, 0) / 84,
    meanMargin: r.games.reduce((v: number, g: any) => v + g.margin, 0) / 84,
    byCount: [2, 3, 4, 5].map((count) => {
      const rows = r.games.filter((g: any) => g.count === count);
      return {
        count,
        wins: rows.filter((g: any) => g.rank === 1).length,
        games: rows.length,
      };
    }),
  };
});
const conclusion = summaries.every(
  (g) => g.interval[0] <= 24 / 84 && g.interval[1] >= 24 / 84,
)
  ? "两项对照均未显示稳定提升：两组区间都包含 24/84 的等强参考。默认仍为原估值 UCT、根候选数 × 32 次模拟，不启用学习模型。模型和 200 ms 预算保留为实验接口。"
  : "结果需结合种子区间和各人数表现判断。此实验报告不自动修改游戏默认算法。";
const text = `# UCT 预算与学习估值：实测结果\n\n${conclusion}\n\n| 比较 | 第一名 | 等强参考 | 按种子块 bootstrap 95% 区间 |\n|---|---:|---:|---:|\n${summaries.map((g) => `| ${g.label} | ${g.wins}/84 (${pct(g.wins / 84)}) | 24/84 | ${g.interval.map(pct).join("–")} |`).join("\n")}\n\n| 比较 | 2 人 | 3 人 | 4 人 | 5 人 |\n|---|---:|---:|---:|---:|\n${summaries.map((g) => `| ${g.label} | ${g.byCount.map((r) => `${r.wins}/${r.games}`).join(" | ")} |`).join("\n")}\n\n训练 ${training.trainGames} 局，开发 ${training.devGames} 局，按整局隔离。91 → 24 → 1，共 2,233 参数。开发集绝对 MSE：原估值 ${training.baselineDevMse.toFixed(2)}，模型 ${training.bestDevMse.toFixed(2)}；同局面去均值 MSE：原估值 ${training.baselineDevCenteredMse.toFixed(2)}，模型 ${training.bestDevCenteredMse.toFixed(2)}。按开发集去均值 MSE 选择第 ${training.selectedEpoch + 1} 轮 checkpoint。开发集误差只作诊断，不代替对局强弱。\n\n${summaries.map((g) => `## ${g.label}\n\n每个种子第一名数：${g.bySeed.join(", ")}。平均排名 ${g.meanRank.toFixed(3)}，对最强对手平均分差 ${g.meanMargin.toFixed(2)}。\n\n${g.sides.map((r) => `${r.side}：${r.searched} 次需要搜索的决策，平均 ${r.meanSearchMs.toFixed(2)} ms、${r.samplesPerSearch.toFixed(1)} 次模拟、${r.transitionsPerSearch.toFixed(1)} 次状态推进；超过 210 ms ${r.over210} 次；截断 ${r.truncated} 次。`).join("\n\n")}`).join("\n\n")}\n\n只有 6 个独立种子，轮换座位不等于 84 个独立样本；区间使用整个种子块重采样。两项实验使用不同对手预算，不能直接相减推算学习模型的收益。模型在最终对局开始前冻结，未用最终结果调参。并行实验时间不作独占机器速度测试。\n\n默认算法是否启用新设置，应结合区间和各人数结果判断，不能只凭总胜场。复现协议见 [ai-value-methods.md](ai-value-methods.md)，原始数据见 ai-uct200-control.json / ai-value-validation.json。\n`;
await writeFile("artifacts/ai-value-benchmark.md", text);
await writeFile(
  "artifacts/ai-value-summary.json",
  JSON.stringify({ training, summaries }, null, 2),
);
console.log(JSON.stringify(summaries, null, 2));
