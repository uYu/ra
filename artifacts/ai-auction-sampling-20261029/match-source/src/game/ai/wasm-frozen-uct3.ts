import type { Action, State } from "../types.ts";
import type { SearchOptions, SearchReport } from "./search.ts";
import { observe } from "../ai.ts";
import { legalActions } from "../engine.ts";
import { makeTiles } from "../data.ts";

const phases = ["turn", "auction", "disaster", "god", "epoch", "over"] as const;
const reasons = ["draw", "invoke", "full"] as const;
const tiles = makeTiles();
type NativeExports = {
  memory: WebAssembly.Memory;
  abi_version(): number;
  input_ptr(): number;
  output_ptr(): number;
  run(
    op: number,
    length: number,
    samples: number,
    horizon: number,
    variant: number,
    timeMs: number,
  ): number;
  _initialize?: () => void;
};
class Reader {
  index = 0;
  readonly values: Float64Array;
  constructor(values: Float64Array) {
    this.values = values;
  }
  number() {
    if (this.index >= this.values.length)
      throw new Error("Wasm 返回数据不完整");
    return this.values[this.index++];
  }
  list() {
    return Array.from({ length: this.number() }, () => this.number());
  }
  action(): Action {
    const type = this.number(),
      arg = this.number(),
      second = this.number(),
      count = this.number();
    switch (type) {
      case 0:
        return { type: "draw" };
      case 1:
        return { type: "invoke" };
      case 2:
        return { type: "bid", sun: arg < 0 ? null : arg };
      case 3:
        return { type: "god", tileId: arg };
      case 4:
        return { type: "finish" };
      case 5:
        return { type: "discard", ids: count === 1 ? [arg] : [arg, second] };
      case 6:
        return { type: "next" };
      default:
        throw new Error("Wasm 返回了未知行动");
    }
  }
}
function encodeState(s: State) {
  const v = [
    1,
    s.players.length,
    s.epoch,
    phases.indexOf(s.phase),
    s.current,
    s.center,
    s.ra,
    s.resume === "god" ? 3 : 0,
    s.next,
    s.steps,
    s.lastTile?.id ?? -1,
  ];
  const list = (ids: number[]) => v.push(ids.length, ...ids);
  for (const ts of [s.bag, s.market, s.pending, s.discarded])
    list(ts.map((t) => t.id));
  for (const p of s.players) {
    v.push(p.score);
    list(p.suns);
    list(p.used);
    list(p.tiles.map((t) => t.id));
  }
  v.push(s.auction ? 1 : 0);
  if (s.auction) {
    const a = s.auction;
    v.push(a.caller, reasons.indexOf(a.reason), a.index, a.high, a.winner);
    list(a.order);
    v.push(a.bids.length);
    for (const b of a.bids) v.push(b.player, b.sun ?? -1);
  }
  return v;
}
function encodeAction(a: Action) {
  switch (a.type) {
    case "draw":
      return [0, -1, -1, 0];
    case "invoke":
      return [1, -1, -1, 0];
    case "bid":
      return [2, a.sun ?? -1, -1, 0];
    case "god":
      return [3, a.tileId, -1, 0];
    case "finish":
      return [4, -1, -1, 0];
    case "discard":
      return [5, a.ids[0], a.ids[1] ?? -1, a.ids.length];
    case "next":
      return [6, -1, -1, 0];
  }
}
function decodeState(r: Reader, source: State): State {
  if (r.number() !== 1) throw new Error("Wasm 状态协议不兼容");
  const count = r.number(),
    epoch = r.number(),
    phase = phases[r.number()],
    current = r.number(),
    center = r.number(),
    ra = r.number(),
    resume = r.number() === 3 ? "god" : "turn",
    next = r.number(),
    steps = r.number(),
    last = r.number();
  const readTiles = () => r.list().map((id) => tiles[id]);
  const bag = readTiles(),
    market = readTiles(),
    pending = readTiles(),
    discarded = readTiles();
  const players = Array.from({ length: count }, (_, i) => ({
    ...source.players[i],
    score: r.number(),
    suns: r.list(),
    used: r.list(),
    tiles: readTiles(),
  }));
  let auction: State["auction"] = null;
  if (r.number()) {
    const caller = r.number(),
      reason = reasons[r.number()],
      index = r.number(),
      high = r.number(),
      winner = r.number(),
      order = r.list();
    const bids = Array.from({ length: r.number() }, () => {
      const player = r.number(),
        sun = r.number();
      return { player, sun: sun < 0 ? null : sun };
    });
    auction = { caller, reason, index, high, winner, order, bids };
  }
  return {
    ...source,
    epoch,
    phase,
    current,
    center,
    ra,
    resume,
    next,
    steps,
    lastTile: last < 0 ? null : tiles[last],
    bag,
    market,
    pending,
    discarded,
    players,
    auction,
    history: [],
    log: [],
  };
}

export class WasmAi {
  private readonly native: NativeExports;
  constructor(native: NativeExports) {
    this.native = native;
    native._initialize?.();
    if (native.abi_version() !== 3) throw new Error("Wasm AI 版本不兼容");
  }
  private call(
    op: number,
    s: State,
    extra: number[] = [],
    samples = 32,
    horizon = 0,
    variant = 0,
    timeMs = 0,
  ) {
    const values = encodeState(s).concat(extra);
    if (values.length > 8192) throw new Error("Wasm 输入状态过大");
    new Float64Array(
      this.native.memory.buffer,
      this.native.input_ptr(),
      8192,
    ).set(values);
    const size = this.native.run(
      op,
      values.length,
      samples,
      horizon,
      variant,
      timeMs,
    );
    if (size < 0) throw new Error(`Wasm AI 拒绝状态或行动（${size}）`);
    // A search may grow memory. Recreate the view AFTER the native call.
    return new Reader(
      new Float64Array(
        this.native.memory.buffer,
        this.native.output_ptr(),
        size,
      ),
    );
  }
  search(state: State, options: SearchOptions = {}): SearchReport {
    const samples = options.samples ?? 32;
    if (!Number.isInteger(samples) || samples < 1 || samples > 512)
      throw new Error("搜索采样次数应为 1–512 的整数");
    const variants = ["uct", "sh", "dpw"];
    const variant = variants.indexOf(options.variant ?? "uct");
    if (variant < 0) throw new Error("未知搜索算法");
    const timeMs = options.timeMs ?? 0;
    if (
      options.timeMs !== undefined &&
      (!Number.isFinite(timeMs) || timeMs < 1 || timeMs > 1000)
    )
      throw new Error("思考时间应为 1–1000 毫秒");
    // Sanitize all public callers, including callers outside the Worker.
    const s = observe(state);
    s.players.forEach((p) => {
      p.score = 100;
    });
    const horizon =
      options.horizon === "game" ? 1 : options.horizon === "next-epoch" ? 2 : 0;
    const r = this.call(0, s, [], samples, horizon, variant, timeMs);
    const report = {
      samples: r.number(),
      transitions: r.number(),
      completed: r.number(),
      truncated: r.number(),
      epochAdvances: r.number(),
      nodes: r.number(),
      depth: r.number(),
      scenarios: r.number(),
      outcomeReuses: r.number(),
      maxOutcomeBranches: r.number(),
    };
    const candidates = Array.from({ length: r.number() }, () => ({
      action: r.action(),
      value: r.number(),
      error: r.number(),
      visits: r.number(),
    }));
    const action = candidates[0]?.action;
    if (!action || !legalActions(s).some((a) => sameAction(a, action)))
      throw new Error("Wasm AI 返回了非法行动");
    return { ...report, action, candidates };
  }
  // Diagnostic operations preserve the supplied bag and scores to compare the
  // native rules with the TS reference. Production search always sanitizes them.
  simulate(s: State, action: Action): State {
    return decodeState(this.call(1, s, encodeAction(action)), s);
  }
  evaluate(s: State) {
    const r = this.call(2, s),
      read = () => Array.from({ length: s.players.length }, () => r.number());
    return { position: read(), future: read(), scores: read() };
  }
  policy(s: State): Action {
    return this.call(3, s).action();
  }
  legal(s: State): Action[] {
    const r = this.call(4, s);
    return Array.from({ length: r.number() }, () => r.action());
  }
  candidates(s: State): Action[] {
    const r = this.call(5, s);
    return Array.from({ length: r.number() }, () => r.action());
  }
  auction(s: State) {
    const r = this.call(6, s),
      actions = Array.from({ length: r.number() }, () => r.action());
    const values = Array.from({ length: s.players.length }, () => r.number());
    return { actions, values, winner: r.number(), sun: r.number() };
  }
}
function sameAction(a: Action, b: Action) {
  if (a.type !== b.type) return false;
  if (a.type === "bid" && b.type === "bid") return a.sun === b.sun;
  if (a.type === "god" && b.type === "god") return a.tileId === b.tileId;
  if (a.type === "discard" && b.type === "discard")
    return (
      a.ids.length === b.ids.length && a.ids.every((id) => b.ids.includes(id))
    );
  return true;
}
export async function createWasmAi(bytes: BufferSource) {
  let memory: WebAssembly.Memory;
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      clock_time_get: (clock: number, _precision: bigint, pointer: number) => {
        if (clock !== 0 && clock !== 1) return 28;
        const ns =
          clock === 0
            ? BigInt(Date.now()) * 1_000_000n
            : BigInt(Math.floor(performance.now() * 1_000_000));
        new DataView(memory.buffer).setBigUint64(pointer, ns, true);
        return 0;
      },
      proc_exit: (code: number) => {
        throw new Error(`Wasm 计算异常退出（${code}）`);
      },
      fd_close: () => 0,
      fd_seek: () => 0,
      fd_write: () => 0,
    },
  });
  memory = instance.exports.memory as WebAssembly.Memory;
  return new WasmAi(instance.exports as unknown as NativeExports);
}
let pending: Promise<WasmAi> | undefined;
export function loadWasmAi() {
  return (pending ??= (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(new URL("./ra-ai.wasm", import.meta.url), {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(`无法加载 Wasm AI（${response.status}）`);
      return await createWasmAi(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  })());
}
