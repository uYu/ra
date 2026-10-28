import { readFile, writeFile } from "node:fs/promises";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { advance, newGame, legalActions } from "../src/game/engine.ts";
import { observe } from "../src/game/ai.ts";
import { random, shuffle, tileName } from "../src/game/data.ts";
import { auctionPlan, policyAction } from "../src/game/ai/policy.ts";
import { relative } from "../src/game/ai/evaluation.ts";
import type { State, Action } from "../src/game/types.ts";
import type { Trace } from "./lib/decision-trace.ts";
type Job = {
  path: string;
  step: number;
  player: number;
  chosen: Action;
  alternatives: Action[];
  state: State;
  study: string;
  count: number;
  seed: number;
};
const key = (a: Action) => JSON.stringify(a);
const summary = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const se = Math.sqrt(
    values.reduce((v, x) => v + (x - mean) ** 2, 0) /
      (values.length - 1) /
      values.length,
  );
  return {
    n: values.length,
    mean,
    se,
    low95: mean - 1.96 * se,
    high95: mean + 1.96 * se,
    lowFamily: mean - 2.74 * se,
  };
};
if (!isMainThread) {
  const ai = await createWasmAi(await readFile("src/game/ai/ra-ai.wasm"));
  const result = (
    source: State,
    action: Action,
    index: number,
    style: number,
  ) => {
    let s = observe(source);
    s.players.forEach((p) => (p.score = 100));
    const rng = random(
      (Math.imul(s.steps + 1, 1398013) ^
        Math.imul(index + 1, 479001599) ^
        0x35a271de) >>>
        0,
    );
    s.bag = shuffle(
      [...s.bag].sort((a, b) => a.id - b.id),
      rng,
    );
    s = ai.simulate(s, action);
    let transitions = 1;
    const model = {
      cost: s.players.map(() => (style === 1 ? 0.8 : 1.2)),
      rivalry: style === 1 ? 0.8 : 0.5,
    };
    while (s.phase !== "over" && transitions < 900) {
      const actions =
        s.phase === "auction"
          ? (style === 0 ? ai.auction(s) : auctionPlan(s, model)).actions
          : [style === 0 ? ai.policy(s) : policyAction(s, model)];
      for (const a of actions) {
        s = ai.simulate(s, a);
        transitions++;
        if (s.phase === "over" || transitions >= 900) break;
      }
    }
    if (s.phase !== "over") throw new Error("Unfinished audit rollout");
    return relative(
      s.players.map((p) => p.score - 100),
      source.current,
      source.players.length === 2 ? 1 : 0.72,
    );
  };
  parentPort!.on("message", ({ job, stage }: { job: Job; stage: string }) => {
    try {
      if (stage === "screen") {
        const chosen = Array.from({ length: 12 }, (_, i) =>
          result(job.state, job.chosen, i, 0),
        );
        const values = job.alternatives.map((action) => ({
          action,
          differences: Array.from(
            { length: 12 },
            (_, i) => result(job.state, action, i, 0) - chosen[i],
          ),
        }));
        values.sort(
          (a, b) => summary(b.differences).mean - summary(a.differences).mean,
        );
        parentPort!.postMessage({
          row: {
            job,
            screen: values.map((v) => ({
              action: v.action,
              ...summary(v.differences),
            })),
          },
        });
      } else {
        const alternative = job.alternatives[0];
        const check = (style: number, start: number, n: number) =>
          summary(
            Array.from(
              { length: n },
              (_, i) =>
                result(job.state, alternative, start + i, style) -
                result(job.state, job.chosen, start + i, style),
            ),
          );
        parentPort!.postMessage({
          row: {
            job,
            confirmation: check(0, 4096, 192),
            aggressive: check(1, 8192, 96),
            conservative: check(2, 12288, 96),
          },
        });
      }
    } catch (error) {
      parentPort!.postMessage({ error: String(error) });
    }
  });
  parentPort!.postMessage({ ready: true });
} else {
  const index = JSON.parse(
    await readFile("artifacts/decision-replay-index.json", "utf8"),
  );
  const jobs: Job[] = [];
  for (const row of index.results) {
    const trace: Trace = JSON.parse(await readFile(row.path, "utf8"));
    let s = newGame(trace.config);
    for (let i = 0; i < trace.actions.length; i++) {
      const d = trace.audit.decisions[i];
      if (
        d.step !== i + 1 ||
        d.player !== s.current ||
        key(trace.actions[i]) !== key(d.report.action)
      )
        throw new Error("Invalid trace alignment");
      if (s.current === row.seat && d.report.candidates.length > 1) {
        const legal = legalActions(s);
        const alternatives = d.report.candidates
          .map((c) => c.action)
          .filter((a) => key(a) !== key(d.report.action));
        if (alternatives.some((a) => !legal.some((b) => key(a) === key(b))))
          throw new Error("Illegal audit alternative");
        jobs.push({
          path: row.path,
          step: i + 1,
          player: s.current,
          chosen: d.report.action,
          alternatives,
          state: s,
          study: row.study,
          count: row.count,
          seed: row.seed,
        });
      }
      s = advance(s, trace.actions[i]);
    }
    if (
      s.phase !== "over" ||
      JSON.stringify(s.history) !== JSON.stringify(trace.audit.history)
    )
      throw new Error("Replay failed");
  }
  const pool = async (items: any[], stage: string) => {
    let next = 0;
    const rows: any[] = [],
      live: Worker[] = [];
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(4, items.length) },
          () =>
            new Promise<void>((resolve, reject) => {
              const w = new Worker(new URL(import.meta.url));
              live.push(w);
              w.on("error", reject);
              w.on("message", (m) => {
                if (m.error) {
                  reject(new Error(m.error));
                  return;
                }
                if (m.row) {
                  rows.push(m.row);
                  if (stage === "confirm" || rows.length % 20 === 0)
                    console.log(
                      JSON.stringify({
                        stage,
                        finished: rows.length,
                        total: items.length,
                        step: m.row.job.step,
                        mean: m.row.confirmation?.mean,
                      }),
                    );
                }
                if (next < items.length)
                  w.postMessage({ job: items[next++], stage });
                else {
                  void w.terminate();
                  resolve();
                }
              });
            }),
        ),
      );
    } finally {
      await Promise.all(live.map((w) => w.terminate()));
    }
    return rows;
  };
  console.log(
    JSON.stringify({
      stage: "screen",
      decisions: jobs.length,
      rolloutsPerAction: 12,
    }),
  );
  const screen = await pool(jobs, "screen");
  await writeFile("artifacts/decision-screen.json", JSON.stringify(screen));
  // Pick the two highest suspected losses per game, before independent confirmation.
  const selected = index.results.flatMap((row: any) =>
    screen
      .filter((r) => r.job.path === row.path)
      .sort((a, b) => b.screen[0].mean - a.screen[0].mean)
      .slice(0, 2)
      .map((r) => ({ ...r.job, alternatives: [r.screen[0].action] })),
  );
  const confirmed = await pool(selected, "confirm");
  const actionText = (a: Action) =>
    a.type === "bid"
      ? a.sun === null
        ? "弃权"
        : `出价 ${a.sun}`
      : a.type === "draw"
        ? "抽牌"
        : a.type === "invoke"
          ? "发起拍卖"
          : a.type === "god"
            ? `神祇兑换牌 ${a.tileId}`
            : a.type === "finish"
              ? "结束兑换"
              : a.type === "discard"
                ? `弃牌 ${a.ids.join(",")}`
                : "进入下一纪元";
  const details = confirmed
    .map((r) => {
      const s: State = r.job.state,
        own = s.players[r.job.player];
      return {
        ...r,
        context: {
          epoch: s.epoch,
          phase: s.phase,
          ra: s.ra,
          center: s.center,
          market: s.market.map(tileName),
          player: own.name,
          suns: own.suns,
          used: own.used,
          holdings: own.tiles.map(tileName),
          auction: s.auction,
          otherPlayers: s.players.map((p, i) => ({
            i,
            name: p.name,
            suns: p.suns,
            used: p.used,
            holdings: p.tiles.map(tileName),
          })),
        },
        robustWithinReviewers:
          r.confirmation.lowFamily > 0 &&
          r.aggressive.low95 > 0 &&
          r.conservative.low95 > 0,
      };
    })
    .sort((a, b) => b.confirmation.mean - a.confirmation.mean);
  const manifest = JSON.parse(await readFile("native/wasm-build.json", "utf8"));
  const output = {
    description:
      "Targeted reruns, not reconstruction of original 168 games. Public-information root; unseen bag re-sampled, all scores normalized100. Compare a single alternative followed by fixed-policy play to actual terminal scores. Policy-continuation sensitivity, not optimal-action proof.",
    sourceSha256: manifest.sourceSha256,
    wasmSha256: manifest.wasmSha256,
    screenedDecisions: jobs.length,
    screenSamples: 12,
    selection:
      "Two largest screen gaps per game; independent confirmation192 + aggressive96 + conservative96 worlds; world ranges disjoint. Paired mean confidence intervals, family threshold z2.74 for 8 selected cases.",
    cases: details.map((r) => ({ ...r, job: { ...r.job, state: undefined } })),
  };
  await writeFile(
    "artifacts/decision-analysis.json",
    JSON.stringify(output, null, 2),
  );
  const fmt = (x: number) => x.toFixed(2),
    ci = (r: any) => `${fmt(r.mean)} [${fmt(r.low95)}, ${fmt(r.high95)}]`;
  const report = `# 逐步决策复盘\n\n原 168 局只保存了汇总，没有行动序列，不能精确复原。本报告是按原汇总最差分差挑选两人/五人各一局、两项实验共四局的**新录制对局**，不能用于估计整体错误率。全部新棋谱已逐步回放核对终局状态。\n\n从被测玩家的 ${jobs.length} 个多候选决策中，用 12 个公共信息采样世界初筛，每局选两处，再用完全不同的 192 个世界确认；另用激进、保守两种续局策略各 96 个世界检查敏感性。替代行动与原行动使用相同牌序；不读取真实隐藏分数或袋中顺序，收益为终局新增分数的相对收益。\n\n更强的 UCT 搜索续局复核与最终结论见 [decision-review.md](decision-review.md)。本表的较稳健标签仅指三种启发式续局，不代表已经确认实战错棋。\n\n下面的“预计改善”是**指定续局策略下**的估计，不是已证明的最优行动，也不能当作这一步实际丢了多少分。95% 区间为逐项区间；较稳健标签还要求主确认通过 8 项比较的近似 Bonferroni 阈值，并且两种续局策略各自的 95% 下界均大于零。\n\n| 棋谱 | 步骤 / 纪元 | 原行动 → 替代 | 预计改善，95% 区间 | 激进 / 保守续局改善 | 证据 |\n|---|---|---|---|---|---|\n${details.map((r) => `| ${r.job.study} ${r.job.count}人 ${r.job.seed} 座位${r.job.player + 1} | ${r.job.step} / ${r.context.epoch} | ${actionText(r.job.chosen)} → ${actionText(r.job.alternatives[0])} | ${ci(r.confirmation)} | ${fmt(r.aggressive.mean)} / ${fmt(r.conservative.mean)} | ${r.robustWithinReviewers ? "较稳健的可疑决策" : "未获跨策略确认"} |`).join("\n")}\n\n${details.map((r) => `## ${r.job.study} ${r.job.count} 人，种子 ${r.job.seed}，第 ${r.job.step} 步\n\n玩家 ${r.context.player}，第 ${r.context.epoch} 纪元，Ra ${r.context.ra}，中央圆盘 ${r.context.center}。可用圆盘：${r.context.suns.join(", ")}；已用圆盘：${r.context.used.join(", ")}。市场：${r.context.market.join("、") || "空"}。藏品：${r.context.holdings.join("、") || "空"}。\n\n实际选择 **${actionText(r.job.chosen)}**，替代为 **${actionText(r.job.alternatives[0])}**。主续局预计改善 ${ci(r.confirmation)}；激进续局 ${ci(r.aggressive)}；保守续局 ${ci(r.conservative)}。${r.robustWithinReviewers ? "在这三种近似续局策略下，替代行动均更好，可优先调查该处决策及其估值。" : "结果尚不够一致，不应直接断言原行动走错。"}\n\n[完整可导入棋谱](../${r.job.path})。原始确认统计与局面见 decision-analysis.json。`).join("\n\n")}\n\n局限：只审查实际搜索候选，没有穷尽被候选剪枝排除的行动；使用固定启发式策略续局，不能代表强搜索对手的真实反应；原模型与原估值的错误归因需要进一步控制实验。\n`;
  await writeFile("artifacts/decision-analysis.md", report);
  console.log(
    JSON.stringify(
      {
        cases: details.map((r) => ({
          study: r.job.study,
          count: r.job.count,
          step: r.job.step,
          chosen: r.job.chosen,
          alternative: r.job.alternatives[0],
          mean: r.confirmation.mean,
          robust: r.robustWithinReviewers,
        })),
      },
      null,
      2,
    ),
  );
}
