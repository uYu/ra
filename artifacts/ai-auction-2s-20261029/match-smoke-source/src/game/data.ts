import type { Kind, Tile } from "./types.ts";
export const LABEL: Record<Kind, string> = {
  monument: "古迹",
  pharaoh: "法老",
  god: "神祇",
  gold: "黄金",
  civilization: "文明",
  nile: "尼罗河",
  flood: "洪水",
  ra: "太阳神",
  earthquake: "地震",
  funeral: "葬礼",
  war: "战争",
  drought: "干旱",
};
export const MONUMENTS = [
  "阶梯金字塔",
  "狮身人面像",
  "金字塔",
  "方尖碑",
  "雕像",
  "陵墓",
  "圣祠",
  "神庙",
];
export const CIVILIZATIONS = ["艺术", "宗教", "文字", "农业", "天文"];
export const COLOR: Record<Kind, string> = {
  monument: "#a87943",
  pharaoh: "#b57739",
  god: "#85708d",
  gold: "#c49a35",
  civilization: "#80906b",
  nile: "#4d8391",
  flood: "#568eac",
  ra: "#c77a3f",
  earthquake: "#a85748",
  funeral: "#a85748",
  war: "#a85748",
  drought: "#a85748",
};
export const GROUPS: Record<number, number[][]> = {
  2: [
    [2, 5, 6, 9],
    [3, 4, 7, 8],
  ],
  3: [
    [2, 5, 8, 13],
    [3, 6, 9, 12],
    [4, 7, 10, 11],
  ],
  4: [
    [2, 6, 13],
    [3, 7, 12],
    [4, 8, 11],
    [5, 9, 10],
  ],
  5: [
    [2, 7, 16],
    [3, 8, 15],
    [4, 9, 14],
    [5, 10, 13],
    [6, 11, 12],
  ],
};
export const RA_LIMIT: Record<number, number> = { 2: 6, 3: 8, 4: 9, 5: 10 };
export const CATEGORIES: Kind[] = [
  "monument",
  "pharaoh",
  "nile",
  "flood",
  "civilization",
  "gold",
  "god",
];
export const disasterKind: Partial<Record<Kind, Kind>> = {
  earthquake: "monument",
  funeral: "pharaoh",
  war: "civilization",
  drought: "nile",
};
export const isDisaster = (kind: Kind) => kind in disasterKind;
export function tileName(t: Tile) {
  return t.kind === "monument"
    ? MONUMENTS[t.variant]
    : t.kind === "civilization"
      ? CIVILIZATIONS[t.variant]
      : LABEL[t.kind];
}
export function makeTiles(): Tile[] {
  const tiles: Tile[] = [];
  const add = (kind: Kind, n: number, variants = 1) => {
    for (let v = 0; v < variants; v++)
      for (let i = 0; i < n; i++)
        tiles.push({ id: tiles.length, kind, variant: v });
  };
  add("monument", 5, 8);
  add("pharaoh", 25);
  add("god", 8);
  add("gold", 5);
  add("civilization", 5, 5);
  add("nile", 25);
  add("flood", 12);
  add("ra", 30);
  add("earthquake", 2);
  add("funeral", 2);
  add("war", 4);
  add("drought", 2);
  return tiles;
}
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: T[], rng: () => number) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function tileLabel(t: Tile) {
  if (t.kind === "monument") return `古迹 ${t.variant + 1}·${tileName(t)}`;
  return t.kind === "civilization"
    ? `${LABEL[t.kind]}·${tileName(t)}`
    : tileName(t);
}
