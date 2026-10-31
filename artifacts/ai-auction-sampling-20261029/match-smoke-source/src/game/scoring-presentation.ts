import type { Kind, State } from "./types.ts";
import { MONUMENTS } from "./data.ts";

export type ScoreReason = { points: number | null; reason: string };
export type ScoreBreakdown = {
  groups: Partial<Record<Kind, ScoreReason>>;
  sun: ScoreReason;
};
export const signedScore = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export function explainScore(state: State, player: number): ScoreBreakdown {
  const row = state.history.at(-1)?.[player];
  if (!row) throw new Error("此纪元尚未结算");
  const p = state.players[player];
  const count = (kind: Kind) =>
    p.tiles.filter((tile) => tile.kind === kind).length;
  const pharaohs = state.players.map(
    (q) => q.tiles.filter((t) => t.kind === "pharaoh").length,
  );
  const phMin = Math.min(...pharaohs),
    phMax = Math.max(...pharaohs);
  const ph = count("pharaoh"),
    nile = count("nile"),
    flood = count("flood");
  const cv = new Set(
    p.tiles.filter((t) => t.kind === "civilization").map((t) => t.variant),
  ).size;
  const monuments = MONUMENTS.map(
    (_, variant) =>
      p.tiles.filter((t) => t.kind === "monument" && t.variant === variant)
        .length,
  );
  const different = monuments.filter(Boolean).length;
  const diversity = different === 8 ? 15 : different === 7 ? 10 : different;
  const sets = monuments.flatMap((n, i) =>
    n >= 3 ? [`${MONUMENTS[i]} ${n} 块 +${(n - 2) * 5} 分`] : [],
  );
  const suns = [...p.suns, ...p.used].sort((a, b) => a - b);
  const totals = state.players.map((q) =>
    [...q.suns, ...q.used].reduce((sum, n) => sum + n, 0),
  );
  const final = state.epoch === 3;
  return {
    groups: {
      monument: {
        points: final ? row.parts.古迹 : null,
        reason: final
          ? `${different} 种古迹得 ${diversity} 分${sets.length ? `；${sets.join("；")}` : "；没有同类成套奖励"}`
          : `已集 ${different} 种古迹，本纪元不计分，保留至第三纪元。`,
      },
      pharaoh: {
        points: row.parts.法老,
        reason:
          phMin === phMax
            ? `全场都是 ${ph} 块法老，不计分。`
            : `持有 ${ph} 块，${ph === phMax ? "全场最多" : ph === phMin ? "全场最少" : "数量居中"}（全场 ${phMin}–${phMax} 块）。`,
      },
      nile: {
        points: flood ? nile : 0,
        reason: flood
          ? `${flood} 块洪水已激活河流：${nile} 块尼罗河 × 1 = ${nile} 分。`
          : `没有洪水，${nile} 块尼罗河无法得分。`,
      },
      flood: {
        points: flood,
        reason: `${flood} 块洪水 × 1 = ${flood} 分；与尼罗河合计 ${row.parts.河流} 分。`,
      },
      civilization: {
        points: row.parts.文明,
        reason:
          cv === 0
            ? "没有文明，扣 5 分。"
            : `${count("civilization")} 块文明共 ${cv} 种；${cv < 3 ? "不足 3 种，不计分" : `${cv} 种得 ${row.parts.文明} 分`}，重复牌不增加种类。`,
      },
      gold: {
        points: row.parts.黄金,
        reason: `${count("gold")} 块黄金 × 3 = ${row.parts.黄金} 分。`,
      },
      god: {
        points: row.parts.神祇,
        reason: `${count("god")} 块未使用神祇 × 2 = ${row.parts.神祇} 分。`,
      },
    },
    sun: {
      points: final ? row.parts.太阳 : null,
      reason: final
        ? `${suns.join(" + ")} = ${totals[player]}；${Math.max(...totals) === Math.min(...totals) ? "全场总和相同，不计分" : totals[player] === Math.max(...totals) ? "全场总和最高" : totals[player] === Math.min(...totals) ? "全场总和最低" : "总和居中，不计分"}。`
        : "本纪元不计分，第三纪元比较全部圆盘总和。",
    },
  };
}
