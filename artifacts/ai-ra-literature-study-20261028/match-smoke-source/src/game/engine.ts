import type {
  Action,
  Config,
  Kind,
  Player,
  ScoreRow,
  State,
  Tile,
} from "./types.ts";
import {
  CATEGORIES,
  disasterKind,
  GROUPS,
  isDisaster,
  LABEL,
  makeTiles,
  RA_LIMIT,
  random,
  shuffle,
  tileName,
} from "./data.ts";
const count = (p: Player, k: Kind) =>
  p.tiles.filter((t) => t.kind === k).length;
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function validateConfig(c: Config) {
  assert(
    c && Number.isInteger(c.count) && c.count >= 2 && c.count <= 5,
    "人数应为 2–5 人",
  );
  assert(
    Number.isInteger(c.humans) && c.humans >= 0 && c.humans <= c.count,
    "玩家人数无效",
  );
  assert(["easy", "normal", "hard"].includes(c.difficulty), "难度无效");
  assert(
    Number.isInteger(c.seed) && c.seed >= 0 && c.seed <= 0xffffffff,
    "种子无效",
  );
}
export function newGame(config: Config): State {
  validateConfig(config);
  const rng = random(config.seed);
  const groups = shuffle(GROUPS[config.count], rng);
  const players = groups.map((suns, i) => ({
    name:
      i < config.humans
        ? config.humans === 1
          ? "你"
          : `玩家 ${i + 1}`
        : ["奈芙蒂蒂", "拉美西斯", "哈特谢普苏特", "图特摩斯", "伊姆霍特普"][i],
    human: i < config.humans,
    suns: [...suns],
    used: [],
    tiles: [],
    score: 10,
  }));
  const current = players.findIndex((p) =>
    p.suns.includes(Math.max(...players.flatMap((p) => p.suns))),
  );
  return {
    config: { ...config },
    epoch: 1,
    phase: "turn",
    players,
    current,
    bag: shuffle(makeTiles(), rng),
    market: [],
    discarded: [],
    center: 1,
    ra: 0,
    auction: null,
    pending: [],
    resume: "turn",
    next: current,
    history: [],
    log: ["第一纪元开始。最高太阳圆盘持有者先行。"],
    lastTile: null,
    steps: 0,
  };
}
function note(s: State, text: string) {
  s.log.push(text);
}
function nextActive(s: State, from: number) {
  for (let k = 1; k <= s.players.length; k++) {
    const i = (from + k) % s.players.length;
    if (s.players[i].suns.length) return i;
  }
  return -1;
}
export function scoreEpoch(s: State): ScoreRow[] {
  const ph = s.players.map((p) => count(p, "pharaoh")),
    sun = s.players.map((p) => sum([...p.suns, ...p.used]));
  return s.players.map((p, i) => {
    const cv = new Set(
      p.tiles.filter((t) => t.kind === "civilization").map((t) => t.variant),
    ).size;
    const parts: Record<string, number> = {
      法老:
        Math.max(...ph) === Math.min(...ph)
          ? 0
          : ph[i] === Math.max(...ph)
            ? 5
            : ph[i] === Math.min(...ph)
              ? -2
              : 0,
      河流: count(p, "flood") ? count(p, "flood") + count(p, "nile") : 0,
      文明: cv === 0 ? -5 : cv >= 3 ? (cv - 2) * 5 : 0,
      黄金: count(p, "gold") * 3,
      神祇: count(p, "god") * 2,
    };
    if (s.epoch === 3) {
      const m = Array.from(
          { length: 8 },
          (_, v) =>
            p.tiles.filter((t) => t.kind === "monument" && t.variant === v)
              .length,
        ),
        different = m.filter(Boolean).length;
      parts.古迹 =
        (different === 8 ? 15 : different === 7 ? 10 : different) +
        sum(m.map((n) => (n >= 3 ? (n - 2) * 5 : 0)));
      parts.太阳 =
        Math.max(...sun) === Math.min(...sun)
          ? 0
          : sun[i] === Math.max(...sun)
            ? 5
            : sun[i] === Math.min(...sun)
              ? -5
              : 0;
    }
    const delta = sum(Object.values(parts));
    return { name: p.name, parts, delta, total: Math.max(0, p.score + delta) };
  });
}
function endEpoch(s: State) {
  const rows = scoreEpoch(s);
  s.history.push(rows);
  s.players.forEach((p, i) => (p.score = rows[i].total));
  s.phase = s.epoch === 3 ? "over" : "epoch";
  s.auction = null;
  note(
    s,
    `第 ${s.epoch} 纪元结束：${rows.map((r) => `${r.name} ${r.delta >= 0 ? "+" : ""}${r.delta}`).join("，")}。`,
  );
}
function finishTurn(s: State, from: number) {
  if (!s.players.some((p) => p.suns.length)) {
    endEpoch(s);
    return;
  }
  s.current = nextActive(s, from);
  s.phase = "turn";
}
function startAuction(s: State, reason: "draw" | "invoke" | "full") {
  const caller = s.current,
    order: number[] = [];
  for (let k = 1; k <= s.players.length; k++) {
    const i = (caller + k) % s.players.length;
    if (s.players[i].suns.length) order.push(i);
  }
  s.auction = {
    caller,
    reason,
    order,
    index: 0,
    high: 0,
    winner: -1,
    bids: [],
  };
  s.phase = "auction";
  s.current = order[0];
  note(
    s,
    `${s.players[caller].name}${reason === "draw" ? "抽到 Ra，触发拍卖" : reason === "full" ? "发起满轨拍卖" : "呼唤 Ra，发起拍卖"}。`,
  );
}
export function disasterOptions(s: State): Tile[] {
  const d = s.pending[0];
  if (!d) return [];
  const tiles = s.players[s.current].tiles;
  if (d.kind === "drought") {
    const floods = tiles.filter((t) => t.kind === "flood");
    return floods.length ? floods : tiles.filter((t) => t.kind === "nile");
  }
  return tiles.filter((t) => t.kind === disasterKind[d.kind]);
}
// Drought selection includes Nile only after all available Floods have been chosen.
export function requiredDiscards(s: State) {
  const d = s.pending[0];
  if (!d) return 0;
  const tiles = s.players[s.current].tiles;
  return Math.min(
    2,
    tiles.filter((t) =>
      d.kind === "drought"
        ? t.kind === "flood" || t.kind === "nile"
        : t.kind === disasterKind[d.kind],
    ).length,
  );
}
export function eligibleDiscards(s: State) {
  const d = s.pending[0];
  return s.players[s.current].tiles.filter((t) =>
    d?.kind === "drought"
      ? t.kind === "flood" || t.kind === "nile"
      : t.kind === disasterKind[d?.kind],
  );
}
function settle(s: State) {
  while (s.pending.length) {
    if (requiredDiscards(s) > 0) {
      s.phase = "disaster";
      return;
    }
    s.discarded.push(s.pending.shift()!);
  }
  if (s.resume === "god") {
    s.phase = "god";
  } else finishTurn(s, s.next);
}
function acquire(
  s: State,
  tiles: Tile[],
  player: number,
  resume: "turn" | "god",
  from: number,
) {
  s.current = player;
  s.players[player].tiles.push(...tiles.filter((t) => !isDisaster(t.kind)));
  s.pending.push(...tiles.filter((t) => isDisaster(t.kind)));
  s.resume = resume;
  s.next = from;
  settle(s);
}
function resolveAuction(s: State) {
  const a = s.auction!;
  s.auction = null;
  if (a.winner < 0) {
    if (a.reason === "full") {
      s.discarded.push(...s.market);
      s.market = [];
    }
    note(
      s,
      a.reason === "full"
        ? "无人出价，满轨拍品全部弃置。"
        : "无人出价，拍品与中央圆盘保留。",
    );
    finishTurn(s, a.caller);
    return;
  }
  const p = s.players[a.winner];
  p.suns = p.suns.filter((n) => n !== a.high);
  p.used.push(s.center);
  s.center = a.high;
  const tiles = s.market;
  s.market = [];
  note(
    s,
    `${p.name}以 ${a.high} 赢得 ${tiles.length} 块拍品，换回已使用圆盘 ${p.used.at(-1)}。`,
  );
  acquire(s, tiles, a.winner, "turn", a.caller);
}
export function mustBid(s: State) {
  const a = s.auction;
  return !!a && s.current === a.caller && a.reason === "invoke" && a.high === 0;
}
export function legalActions(s: State): Action[] {
  const p = s.players[s.current];
  if (s.phase === "epoch") return [{ type: "next" }];
  if (s.phase === "over") return [];
  if (s.phase === "auction")
    return [
      ...p.suns
        .filter((n) => n > s.auction!.high)
        .map((sun) => ({ type: "bid" as const, sun })),
      ...(!mustBid(s) ? [{ type: "bid" as const, sun: null }] : []),
    ];
  if (s.phase === "disaster") {
    const all = eligibleDiscards(s),
      n = requiredDiscards(s),
      out: Action[] = [];
    const valid = (ids: number[]) =>
      s.pending[0].kind !== "drought" ||
      ids.filter((id) => all.find((t) => t.id === id)?.kind === "flood")
        .length === Math.min(n, all.filter((t) => t.kind === "flood").length);
    if (n === 1)
      for (const t of all) {
        if (valid([t.id])) out.push({ type: "discard", ids: [t.id] });
      }
    else
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          if (valid([all[i].id, all[j].id]))
            out.push({ type: "discard", ids: [all[i].id, all[j].id] });
    return out;
  }
  const gods: Action[] = count(p, "god")
    ? s.market
        .filter((t) => t.kind !== "god")
        .map((t) => ({ type: "god", tileId: t.id }))
    : [];
  if (s.phase === "god") return [...gods, { type: "finish" }];
  return [
    ...(s.market.length < 8 && s.bag.length ? [{ type: "draw" as const }] : []),
    { type: "invoke" },
    ...gods,
  ];
}
export function advance(state: State, action: Action): State {
  assert(action && typeof action === "object", "无效行动");
  const legal = legalActions(state).some(
    (a) =>
      a.type === action.type &&
      (a.type === "bid"
        ? a.sun === (action as typeof a).sun
        : a.type === "god"
          ? a.tileId === (action as typeof a).tileId
          : a.type === "discard"
            ? Array.isArray((action as typeof a).ids) &&
              a.ids.length === (action as typeof a).ids.length &&
              a.ids.every((id) => (action as typeof a).ids.includes(id))
            : true),
  );
  assert(legal, "当前不能执行这个行动");
  return applyAction(structuredClone(state), action);
}

// Search uses exactly the same rules as real play. Tiles and score rows are
// immutable; copy only containers the transition can change, and omit old logs.
// The caller must supply a legal action (the public advance API still validates).
export function simulate(state: State, action: Action): State {
  return applyAction(
    {
      ...state,
      bag: [...state.bag],
      market: [...state.market],
      discarded: [...state.discarded],
      pending: [...state.pending],
      players: state.players.map((p) => ({
        ...p,
        suns: [...p.suns],
        used: [...p.used],
        tiles: [...p.tiles],
      })),
      auction: state.auction
        ? {
            ...state.auction,
            order: [...state.auction.order],
            bids: [...state.auction.bids],
          }
        : null,
      history: [...state.history],
      log: [],
    },
    action,
  );
}

function applyAction(s: State, action: Action): State {
  s.steps++;
  const p = s.players[s.current];
  switch (action.type) {
    case "draw": {
      const t = s.bag.pop()!;
      s.lastTile = t;
      note(s, `${p.name}抽到「${tileName(t)}」。`);
      if (t.kind === "ra") {
        s.discarded.push(t);
        s.ra++;
        if (s.ra >= RA_LIMIT[s.config.count]) endEpoch(s);
        else startAuction(s, "draw");
      } else {
        s.market.push(t);
        finishTurn(s, s.current);
      }
      break;
    }
    case "invoke":
      startAuction(s, s.market.length === 8 ? "full" : "invoke");
      break;
    case "bid": {
      const a = s.auction!;
      a.bids.push({ player: s.current, sun: action.sun });
      note(
        s,
        `${p.name}${action.sun === null ? "放弃出价" : `出价 ${action.sun}`}。`,
      );
      if (action.sun !== null) {
        a.high = action.sun;
        a.winner = s.current;
      }
      a.index++;
      if (a.index === a.order.length) resolveAuction(s);
      else s.current = a.order[a.index];
      break;
    }
    case "god": {
      const god = p.tiles.find((t) => t.kind === "god")!;
      p.tiles = p.tiles.filter((t) => t.id !== god.id);
      s.discarded.push(god);
      const t = s.market.find((t) => t.id === action.tileId)!;
      s.market = s.market.filter((x) => x.id !== t.id);
      note(s, `${p.name}使用神祇，取得「${tileName(t)}」。`);
      acquire(s, [t], s.current, "god", s.current);
      break;
    }
    case "finish":
      note(s, `${p.name}结束神祇交换。`);
      finishTurn(s, s.current);
      break;
    case "discard": {
      const removed = p.tiles.filter((t) => action.ids.includes(t.id));
      p.tiles = p.tiles.filter((t) => !action.ids.includes(t.id));
      const d = s.pending.shift()!;
      s.discarded.push(...removed, d);
      note(
        s,
        `${p.name}因${LABEL[d.kind]}弃置${removed.map(tileName).join("、")}。`,
      );
      settle(s);
      break;
    }
    case "next": {
      s.epoch++;
      s.ra = 0;
      s.discarded.push(...s.market);
      s.market = [];
      for (const q of s.players) {
        const keep = q.tiles.filter((t) =>
          ["monument", "pharaoh", "nile"].includes(t.kind),
        );
        s.discarded.push(...q.tiles.filter((t) => !keep.includes(t)));
        q.tiles = keep;
        q.suns.push(...q.used);
        q.suns.sort((a, b) => a - b);
        q.used = [];
      }
      s.current = s.players.findIndex((q) =>
        q.suns.includes(Math.max(...s.players.flatMap((q) => q.suns))),
      );
      s.phase = "turn";
      s.lastTile = null;
      note(s, `第 ${s.epoch} 纪元开始，${s.players[s.current].name}先行。`);
      break;
    }
  }
  return s;
}
export function ranking(s: State) {
  return s.players
    .map((p, i) => ({
      player: i,
      score: p.score,
      sun: Math.max(...p.suns, ...p.used),
    }))
    .sort((a, b) => b.score - a.score || b.sun - a.sun);
}
export function tileCounts(p: Player) {
  return Object.fromEntries(CATEGORIES.map((k) => [k, count(p, k)])) as Record<
    Kind,
    number
  >;
}
