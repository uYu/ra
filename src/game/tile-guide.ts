import type { Kind, Player } from "./types.ts";
export type TileGuide = {
  effect: string;
  secondary: string;
  timing: string;
  lifecycle: string;
  detail: string;
  example: string;
};
export const TILE_GUIDE: Record<Kind, TileGuide> = {
  monument: {
    effect: "收集种类，同类成套",
    secondary: "只在第三纪元得分",
    timing: "终局计分",
    lifecycle: "跨纪元保留",
    detail:
      "古迹有 8 种。收集 1–6 种时每种 1 分，7 / 8 种得 10 / 15 分；此外，每种收集到 3 / 4 / 5 块，额外得 5 / 10 / 15 分。种类分与同类奖励相加。",
    example: "3 块方尖碑 + 1 块神庙：2 种得 2 分，3 块同类再得 5 分，共 7 分。",
  },
  pharaoh: {
    effect: "最多 +5，最少 −2",
    secondary: "每纪元与所有人比较",
    timing: "每纪元计分",
    lifecycle: "跨纪元保留",
    detail:
      "每个纪元末，拥有法老最多的玩家得 5 分，最少的玩家失去 2 分。并列者分别得失相应分数；所有人数量相同则都不计分。",
    example: "三人分别有 4、2、2 块法老：第一人 +5 分，后两人各 −2 分。",
  },
  nile: {
    effect: "有洪水：每块 +1 分",
    secondary: "没有洪水则得 0 分",
    timing: "每纪元计分",
    lifecycle: "跨纪元保留",
    detail:
      "只有本纪元至少拥有一块洪水，你的尼罗河牌才能得分，每块 1 分。尼罗河会保留，但洪水每纪元结算后弃置，所以下纪元需要重新收集洪水。",
    example: "4 块尼罗河 + 1 块洪水：尼罗河得 4 分，洪水再得 1 分，共 5 分。",
  },
  flood: {
    effect: "每块 +1 分",
    secondary: "激活你所有的尼罗河",
    timing: "每纪元计分",
    lifecycle: "纪元末弃置",
    detail:
      "每块洪水得 1 分；只要有至少一块洪水，就让你持有的全部尼罗河牌每块也得 1 分。多块洪水不会让尼罗河重复计分。",
    example: "3 块尼罗河 + 2 块洪水共 5 分；只有 2 块洪水也可得 2 分。",
  },
  civilization: {
    effect: "集 3 / 4 / 5 种文明",
    secondary: "5 / 10 / 15 分；无文明 −5",
    timing: "每纪元计分",
    lifecycle: "纪元末弃置",
    detail:
      "文明共有艺术、宗教、文字、农业、天文五种。只按不同种类计分：3 / 4 / 5 种得 5 / 10 / 15 分；1–2 种得 0 分；一块文明都没有则扣 5 分。重复牌不增加种类。",
    example: "艺术、宗教、文字各一块得 5 分；三块艺术只算 1 种，得 0 分。",
  },
  gold: {
    effect: "每块 +3 分",
    secondary: "直接增加你的声望",
    timing: "每纪元计分",
    lifecycle: "纪元末弃置",
    detail:
      "每块黄金在本纪元末得到 3 分。没有收集条件，不需要搭配其他牌；本纪元计分后弃置。",
    example: "2 块黄金在本纪元末得到 6 分。",
  },
  god: {
    effect: "换取 1 块非神拍品",
    secondary: "不使用则每块 +2 分",
    timing: "回合使用 / 纪元计分",
    lifecycle: "使用后或纪元末弃置",
    detail:
      "在自己的回合，可以花一块神祇，从拍卖轨直接拿一块非神祇牌，不花太阳圆盘。同一回合可以连续使用多块神祇；换到灾难也要立即处理。纪元末未用的神祇每块得 2 分。",
    example: "用一块神祇直接拿走黄金；或者保留神祇，在纪元末获得 2 分。",
  },
  ra: {
    effect: "太阳船前进 1 格",
    secondary: "触发拍卖；末格直接结算",
    timing: "抽到立即生效",
    lifecycle: "不进入你的王国",
    detail:
      "抽到 Ra 时立即推进太阳船。若没到终点则进行拍卖；若恰好到终点，本纪元立即结束，不进行最后一次拍卖。主动呼唤 Ra 不推进太阳船。",
    example: "太阳船还差一格到终点时抽到 Ra，轨上所有拍品都不会再拍卖。",
  },
  earthquake: {
    effect: "弃掉 2 块古迹",
    secondary: "可以选择弃哪些古迹",
    timing: "获得后立即生效",
    lifecycle: "灾难 · 结算后弃置",
    detail:
      "从自己的王国中选两块古迹弃掉，包括本次刚获得的古迹。不足两块则全部弃掉，没有古迹则不损失牌。每块地震分别处理。",
    example:
      "你原有两块神庙，又拍到一块金字塔和地震：要从这三块古迹中选择两块弃置。",
  },
  funeral: {
    effect: "弃掉 2 块法老",
    secondary: "可能失去法老多数奖励",
    timing: "获得后立即生效",
    lifecycle: "灾难 · 结算后弃置",
    detail:
      "弃掉自己两块法老，包括本次刚获得的牌。不足两块则全部弃掉，没有法老则不损失牌。法老减少可能改变每纪元的多数和少数计分。",
    example: "拥有 3 块法老时获得葬礼，弃掉两块，剩下 1 块。",
  },
  war: {
    effect: "弃掉 2 块文明",
    secondary: "可选择，注意保住不同种类",
    timing: "获得后立即生效",
    lifecycle: "灾难 · 结算后弃置",
    detail:
      "选择自己两块文明弃掉，包括本次刚获得的文明。不足两块则全部弃掉。通常可以优先弃掉重复种类，保住不同文明的集合。",
    example:
      "两块艺术、一块文字、一块农业时遭遇战争，可以弃两块艺术，保留文字和农业。",
  },
  drought: {
    effect: "弃掉 2 块河流牌",
    secondary: "先弃洪水，再弃尼罗河",
    timing: "获得后立即生效",
    lifecycle: "灾难 · 结算后弃置",
    detail:
      "弃掉两块洪水或尼罗河，必须优先弃洪水；洪水不足两块时，再弃尼罗河。包括本次刚获得的牌。失去最后一块洪水，会让剩余尼罗河本纪元无法得分。",
    example:
      "1 块洪水 + 4 块尼罗河遭遇干旱：弃 1 块洪水和 1 块尼罗河，剩下的 3 块尼罗河暂时得 0 分。",
  },
};
export function collectionProgress(p: Player, kind: Kind) {
  const tiles = p.tiles.filter((t) => t.kind === kind),
    n = tiles.length;
  if (kind === "monument")
    return `已收集 ${new Set(tiles.map((t) => t.variant)).size} / 8 种 · 终局结算`;
  if (kind === "civilization") {
    const types = new Set(tiles.map((t) => t.variant)).size;
    return types === 0
      ? "尚无文明：本纪元 −5 分"
      : `${types} / 5 种文明 · ${types >= 3 ? `当前 +${(types - 2) * 5} 分` : "凑齐 3 种开始得分"}`;
  }
  if (kind === "nile")
    return p.tiles.some((t) => t.kind === "flood")
      ? `洪水已激活 · 当前 +${n} 分`
      : `缺少洪水 · ${n} 块暂得 0 分`;
  if (kind === "flood")
    return n ? `当前 +${n} 分 · 尼罗河已激活` : "尚无洪水 · 尼罗河无法得分";
  if (kind === "gold") return `本纪元当前 +${n * 3} 分`;
  if (kind === "god") return `${n} 次换牌机会 · 留下可得 ${n * 2} 分`;
  if (kind === "pharaoh") return `已收集 ${n} 块 · 比较所有玩家数量`;
  return "";
}
