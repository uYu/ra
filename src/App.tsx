import type { Tile as TileType } from "./game/types.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  History,
  Home,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Upload,
} from "lucide-react";
import type { Action, Config, Difficulty, Save, State } from "./game/types.ts";
import {
  advance,
  eligibleDiscards,
  legalActions,
  mustBid,
  newGame,
  ranking,
  requiredDiscards,
  scoreEpoch,
} from "./game/engine.ts";
import { observe } from "./game/ai.ts";
import { LABEL, tileName } from "./game/data.ts";
import {
  createSave,
  downloadSave,
  parseSave,
  replay,
  SAVE_KEY,
} from "./game/storage.ts";
import { readPreferences, writePreferences } from "./game/preferences.ts";
import { Glyph, Landscape, Sun } from "./components/Art.tsx";
import { Tile, TileInfoContext } from "./components/Tile.tsx";
import { TileDetails } from "./components/TileDetails.tsx";
import type { Move } from "./game/presentation.ts";
import { describeMove, recentMoves } from "./game/presentation.ts";
import { ActionFeed } from "./components/ActionFeed.tsx";
import { ActionMotion, captureAnchors } from "./components/ActionMotion.tsx";
import type { Motion } from "./components/ActionMotion.tsx";
import { PlayerMat } from "./components/PlayerMat.tsx";
import { AcquisitionNotice } from "./components/AcquisitionNotice.tsx";
import { TileArt } from "./components/TileArt.tsx";
import { PublicBoard } from "./components/PublicBoard.tsx";
import { GameNavigation } from "./components/GameNavigation.tsx";
import { Dialog } from "./components/Dialog.tsx";
import { Rules } from "./components/Rules.tsx";
import { ScoreBoard } from "./components/ScoreBoard.tsx";
import { AuctionCallerBadge } from "./components/AuctionCallerBadge.tsx";

const DIFFICULTIES: Record<Difficulty, string> = {
  easy: "入门 · 神庙学徒",
  normal: "标准 · 王朝顾问",
  hard: "进阶 · 大祭司 · 2 秒思考",
};
function initial() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return { save: raw ? parseSave(raw) : null, error: "" };
  } catch {
    return { save: null, error: "本地存档无法读取。可导入备份或开始新王朝。" };
  }
}
function Disk({
  value,
  used = false,
  selected = false,
  onClick,
  disabled = false,
}: {
  value: number;
  used?: boolean;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`disk ${used ? "used" : ""} ${selected ? "selected" : ""}`}
      disabled={disabled || !onClick}
      onClick={onClick}
      aria-label={`太阳圆盘 ${value}${used ? "，已使用" : ""}`}
      aria-pressed={selected}
    >
      <span>{value}</span>
      <small>{used ? "已用" : "☼"}</small>
    </button>
  );
}
function App() {
  const [loaded] = useState(initial),
    [save, setSave] = useState<Save | null>(loaded.save),
    [game, setGame] = useState<State | null>(() =>
      loaded.save ? replay(loaded.save) : null,
    );
  const [screen, setScreen] = useState<"menu" | "game" | "replay">("menu"),
    [modal, setModal] = useState<
      "rules" | "settings" | "log" | "new" | "tile" | "move" | null
    >(null),
    [paused, setPaused] = useState(false),
    [error, setError] = useState(loaded.error);
  const [tileInfo, setTileInfo] = useState<TileType | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [moveInfo, setMoveInfo] = useState<Move | null>(null);
  const [acquisitions, setAcquisitions] = useState<Record<number, Move>>({});
  const [stepMode, setStepMode] = useState(false),
    [waiting, setWaiting] = useState(false);
  const [preferences] = useState(readPreferences);
  const [count, setCount] = useState(preferences.count),
    [humans, setHumans] = useState(preferences.humans),
    [difficulty, setDifficulty] = useState<Difficulty>(preferences.difficulty),
    [speed, setSpeed] = useState(preferences.speed),
    [sound, setSound] = useState(preferences.sound);
  useEffect(() => {
    writePreferences({ count, humans, difficulty, speed, sound });
  }, [count, humans, difficulty, speed, sound]);
  const [selectedSun, setSelectedSun] = useState<number | null>(null),
    [selectedTiles, setSelectedTiles] = useState<number[]>([]),
    [godMode, setGodMode] = useState(false),
    [inspect, setInspect] = useState(0);
  const [resultDismissed, setResultDismissed] = useState(""),
    [replayIndex, setReplayIndex] = useState(0),
    [replayPlaying, setReplayPlaying] = useState(false),
    [aiError, setAiError] = useState(""),
    [retry, setRetry] = useState(0);
  const [importing, setImporting] = useState(false),
    [reveal, setReveal] = useState<number | null>(null);
  const finishGodFor = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null),
    audioRef = useRef<AudioContext | null>(null);
  const viewed = useMemo(
    () => (screen === "replay" && save ? replay(save, replayIndex) : game),
    [game, screen, save, replayIndex],
  );
  const moves = useMemo(
    () =>
      save
        ? recentMoves(
            save,
            screen === "replay" ? replayIndex : save.actions.length,
          )
        : [],
    [save, screen, replayIndex],
  );
  const active =
    screen === "game" &&
    !!game &&
    game.players[game.current].human &&
    !paused &&
    !modal &&
    !aiError &&
    !motion;
  useEffect(() => {
    if (screen !== "game") setMotion(null);
  }, [screen]);
  const latestMove = moves.at(-1);
  const unreadAcquisitions = screen === "game" ? acquisitions : {};
  const acquisition = Object.entries(unreadAcquisitions)
    .filter(([i]) => Number(i) !== inspect)
    .sort((a, b) => b[1].step - a[1].step)[0];
  function acknowledgeAcquisition(player: number) {
    setAcquisitions((previous) => {
      const next = { ...previous };
      delete next[player];
      return next;
    });
  }
  function viewPlayer(player: number) {
    setInspect(player);
    acknowledgeAcquisition(player);
  }
  const resultKey = viewed
    ? `${viewed.config.seed}:${viewed.epoch}:${viewed.phase}`
    : "";
  const showResult =
    screen === "game" &&
    viewed &&
    (viewed.phase === "epoch" || viewed.phase === "over") &&
    resultDismissed !== resultKey &&
    !modal &&
    !motion;
  const resetSelection = () => {
    setSelectedSun(null);
    setSelectedTiles([]);
    setGodMode(false);
  };
  function tone() {
    if (!sound) return;
    try {
      const audio = audioRef.current ?? (audioRef.current = new AudioContext());
      void audio.resume();
      const osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(260, audio.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
      osc.start();
      osc.stop(audio.currentTime + 0.2);
    } catch {
      /* Sound is optional. */
    }
  }
  function commit(action: Action, endAfterExchange = false) {
    if (!game || !save || motion) return;
    try {
      const next = advance(game, action);
      if (action.type === "god")
        finishGodFor.current = endAfterExchange ? game.current : null;
      const move = describeMove(game, action, next);
      setMotion({
        id: next.steps,
        before: game,
        after: next,
        action,
        origins: captureAnchors(),
      });
      const recipient = move.winner ?? move.actor;
      if (
        ["win", "god"].includes(move.kind) &&
        move.tiles.length &&
        recipient !== inspect
      )
        setAcquisitions((previous) => ({ ...previous, [recipient]: move }));
      setGame(next);
      setWaiting(
        stepMode &&
          !game.players[game.current].human &&
          !next.players[next.current].human &&
          ["turn", "auction", "disaster", "god"].includes(next.phase),
      );
      setSave({ ...save, actions: [...save.actions, action] });
      resetSelection();
      setAiError("");
      tone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const player = finishGodFor.current;
    if (player === null) return;
    if (
      !game ||
      screen !== "game" ||
      game.current !== player ||
      !["god", "disaster"].includes(game.phase)
    ) {
      finishGodFor.current = null;
      return;
    }
    // Keep disaster choices interactive and finish only after their animations.
    if (game.phase === "god" && active) {
      finishGodFor.current = null;
      commit({ type: "finish" });
    }
  }, [game, screen, active]);
  useEffect(() => {
    if (!save) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      setError("自动保存失败，请导出存档备份。");
    }
  }, [save]);
  useEffect(() => {
    resetSelection();
    setReveal(null);
  }, [viewed?.steps, screen]);
  useEffect(() => {
    if (
      screen !== "game" ||
      !game ||
      game.players[game.current].human ||
      !["turn", "auction", "god", "disaster"].includes(game.phase) ||
      paused ||
      modal ||
      waiting ||
      motion ||
      aiError
    )
      return;
    let alive = true;
    const worker = new Worker(new URL("./game/ai.worker.ts", import.meta.url), {
      type: "module",
    });
    let timer: ReturnType<typeof setTimeout>;
    const started = performance.now();
    worker.onmessage = (e) => {
      if (!alive) return;
      if (e.data.error) {
        setAiError(e.data.error);
        return;
      }
      timer = setTimeout(
        () => {
          if (alive) commit(e.data.action);
        },
        Math.max(900, speed - (performance.now() - started)),
      );
    };
    worker.onerror = () => {
      if (alive) setAiError("电脑对手计算失败，请重试。");
    };
    worker.postMessage({
      state: observe(game),
      difficulty: game.config.difficulty,
    });
    return () => {
      alive = false;
      worker.terminate();
      clearTimeout(timer);
    };
    // Each worker turn is cancelled whenever the table or an overlay changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    game,
    screen,
    paused,
    modal,
    speed,
    aiError,
    retry,
    waiting,
    stepMode,
    motion,
  ]);
  useEffect(() => {
    if (screen !== "replay" || !replayPlaying || !save || modal) return;
    if (replayIndex >= save.actions.length) {
      setReplayPlaying(false);
      return;
    }
    const timer = setTimeout(() => setReplayIndex((n) => n + 1), speed);
    return () => clearTimeout(timer);
  }, [screen, replayIndex, replayPlaying, save, speed, modal]);
  function start() {
    const config: Config = {
      count,
      humans: Math.min(humans, count),
      difficulty,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
    };
    setWaiting(false);
    setGame(newGame(config));
    setSave(createSave(config));
    setScreen("game");
    setModal(null);
    setPaused(false);
    setInspect(0);
    setAcquisitions({});
    setResultDismissed("");
    setError("");
    setAiError("");
    resetSelection();
  }
  async function importFile(file: File) {
    setImporting(true);
    try {
      if (file.size > 5_000_000) throw new Error("文件过大");
      const loadedSave = parseSave(await file.text()),
        state = replay(loadedSave);
      setWaiting(false);
      setSave(loadedSave);
      setGame(state);
      setScreen("game");
      setModal(null);
      setPaused(true);
      setResultDismissed("");
      setAiError("");
      setError("");
      setInspect(0);
      setAcquisitions({});
      resetSelection();
    } catch (e) {
      setError(`导入失败：${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function enterReplay() {
    if (!save) return;
    setReplayIndex(0);
    setReplayPlaying(false);
    setModal(null);
    setScreen("replay");
    setInspect(0);
    setAcquisitions({});
  }
  function toggleTile(id: number) {
    setSelectedTiles((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }
  const humanName = viewed?.players[viewed.current].name;
  const actor = viewed?.players[viewed.current];
  const available = viewed ? legalActions(viewed) : [];
  const discardValid = available.some(
    (a) =>
      a.type === "discard" &&
      a.ids.length === selectedTiles.length &&
      a.ids.every((id) => selectedTiles.includes(id)),
  );
  const exchangeValid =
    selectedTiles.length === 1 &&
    available.some((a) => a.type === "god" && a.tileId === selectedTiles[0]);
  const canContinueExchange =
    !!actor &&
    actor.tiles.filter((t) => t.kind === "god").length > 1 &&
    !!viewed &&
    viewed.market.filter((t) => t.kind !== "god").length > 1;
  const inspecting =
    viewed?.players[Math.min(inspect, viewed.players.length - 1)];
  const estimate = viewed ? scoreEpoch(viewed) : [];
  const title =
    viewed?.phase === "auction"
      ? `${humanName}的出价回合`
      : viewed?.phase === "disaster"
        ? `${humanName}需要处理${LABEL[viewed.pending[0].kind]}`
        : viewed?.phase === "god" || godMode
          ? `${humanName}正在使用神祇`
          : viewed?.phase === "epoch"
            ? "这个纪元，已成为历史"
            : viewed?.phase === "over"
              ? "诸王的故事，写入永恒"
              : `${humanName}的回合`;
  const status =
    viewed?.phase === "auction"
      ? `当前最高 ${viewed.auction!.high || "尚无出价"} · 每人仅一次机会`
      : viewed?.phase === "disaster"
        ? `选择 ${requiredDiscards(viewed)} 块弃置${viewed.pending[0].kind === "drought" ? "，必须优先选择洪水" : ""}${finishGodFor.current === viewed.current ? "；处理后自动结束回合" : ""}`
        : viewed?.phase === "god" || godMode
          ? "选择拍品继续交换，或点击“结束回合”"
          : viewed?.phase === "turn"
            ? "抽取未知，或在恰好的时刻呼唤太阳神。"
            : "查看结算，见证王朝兴衰。";
  return (
    <TileInfoContext.Provider
      value={(tile) => {
        setTileInfo(tile);
        setModal("tile");
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      {screen === "menu" && (
        <header className="site-header">
          <button
            className="brand"
            onClick={() => {
              setScreen("menu");
              setReplayPlaying(false);
            }}
            aria-label="返回主菜单"
          >
            <Sun />
            <span>
              <b>RA</b>
              <i>太阳神</i>
            </span>
          </button>
          <div className="header-note">REINER KNIZIA’S AUCTION CLASSIC</div>
          <nav>
            <button onClick={() => setModal("rules")}>
              <BookOpen size={17} />
              <span>游戏规则</span>
            </button>
            <button onClick={() => setModal("settings")} aria-label="设置">
              <Settings2 size={18} />
            </button>
          </nav>
        </header>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {screen === "menu" ? (
        <main className="menu-screen">
          <section className="hero-copy">
            <div className="eyebrow">
              <span /> THE NILE REMEMBERS
            </div>
            <h1>
              每一次日出，
              <br />
              都是一个<span>新王朝。</span>
            </h1>
            <p className="hero-description">
              让尼罗河见证你的远见。以太阳为筹码，
              <br className="desktop-br" />
              在文明、财富与命运之间，竞逐永恒。
            </p>
            <div className="hero-actions">
              <button className="primary" onClick={() => setModal("new")}>
                开启你的王朝 <ArrowRight size={18} />
              </button>
              {save && (
                <button
                  className="secondary"
                  onClick={() => {
                    setScreen("game");
                    setPaused(false);
                  }}
                >
                  继续比赛 <ChevronRight size={16} />
                </button>
              )}
            </div>
            <div className="game-facts">
              <div>
                <b>2–5</b>
                <span>位统治者</span>
              </div>
              <div>
                <b>III</b>
                <span>个纪元</span>
              </div>
              <div>
                <b>30–60</b>
                <span>分钟 · 实体版参考</span>
              </div>
            </div>
          </section>
          <section className="hero-art">
            <div className="art-frame">
              <Landscape />
              <div className="art-caption">
                <span>𓂀</span>
                <div>
                  THE GOLDEN AGE OF EGYPT<small>文明会消逝，荣耀将长存。</small>
                </div>
                <span>01 — 03</span>
              </div>
            </div>
            <div className="art-seal">
              太阳之下
              <br />
              <b>万物皆有价值</b>
            </div>
          </section>
          <section className="menu-bottom">
            <div className="intro-symbol">
              <Glyph kind="ra" />
            </div>
            <div>
              <span className="eyebrow">
                A LITTLE COURAGE. A LITTLE FORESIGHT.
              </span>
              <h3>抽牌。竞价。把握属于你的时刻。</h3>
              <p>完整基础规则 · 本地电脑对手 · 同屏好友对局 · 自动保存</p>
            </div>
            <button className="text-button" onClick={() => setModal("rules")}>
              第一次来到尼罗河？ <ArrowRight size={18} />
            </button>
          </section>
          <footer>
            <span>RA · 太阳神 / 非官方桌游实现</span>
            <span>本地运行，无需账号。原创矢量画面。</span>
          </footer>
        </main>
      ) : (
        viewed && (
          <div className="game-shell">
            <GameNavigation
              replay={screen === "replay"}
              paused={paused}
              sound={sound}
              onHome={() => {
                setScreen("menu");
                setReplayPlaying(false);
              }}
              onRules={() => setModal("rules")}
              onLog={() => setModal("log")}
              onSettings={() => setModal("settings")}
              onPause={() => setPaused((p) => !p)}
              onSound={() => setSound((s) => !s)}
            />
            <main className="game-screen table-fit">
              <div className="table-heading">
                <div>
                  <h1>
                    尼罗河的竞逐{" "}
                    <span>
                      {screen === "replay"
                        ? "对局回放"
                        : `${viewed.config.count} 人对局`}
                    </span>
                  </h1>
                </div>
              </div>
              {screen === "replay" && (
                <div className="replay-bar">
                  <button
                    onClick={() => setReplayIndex((n) => Math.max(0, n - 1))}
                    disabled={replayIndex === 0}
                    aria-label="上一步"
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    onClick={() => setReplayPlaying((p) => !p)}
                    aria-label={replayPlaying ? "暂停回放" : "播放回放"}
                  >
                    {replayPlaying ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <input
                    aria-label="回放进度"
                    type="range"
                    min={0}
                    max={save!.actions.length}
                    value={replayIndex}
                    onChange={(e) => {
                      setReplayIndex(+e.target.value);
                      setReplayPlaying(false);
                    }}
                  />
                  <span>
                    {replayIndex} / {save!.actions.length}
                  </span>
                  <button
                    onClick={() =>
                      setReplayIndex((n) =>
                        Math.min(save!.actions.length, n + 1),
                      )
                    }
                    disabled={replayIndex === save!.actions.length}
                    aria-label="下一步"
                  >
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setScreen("game");
                      setPaused(true);
                      setReplayPlaying(false);
                    }}
                  >
                    返回对局
                  </button>
                </div>
              )}
              <div className="game-layout">
                <div className="table-main">
                  <PublicBoard
                    state={viewed}
                    latest={latestMove}
                    moving={!!motion}
                    canExchange={active && (viewed.phase === "god" || godMode)}
                    selected={selectedTiles}
                    onSelect={(id) => setSelectedTiles([id])}
                  />
                  <section
                    className={`action-panel phase-${viewed.phase} ${godMode ? "exchanging" : ""}`}
                    aria-live="polite"
                  >
                    <div className="action-heading">
                      <div className="status-icon">
                        <Glyph
                          kind={
                            viewed.phase === "auction"
                              ? "gold"
                              : viewed.phase === "disaster"
                                ? "war"
                                : "ra"
                          }
                        />
                      </div>
                      <div>
                        <h2>{title}</h2>
                        <p>
                          {paused
                            ? "比赛已暂停，继续后恢复行动。"
                            : !actor?.human &&
                                screen === "game" &&
                                ["turn", "auction", "disaster", "god"].includes(
                                  viewed.phase,
                                )
                              ? "电脑正在思考…"
                              : status}
                        </p>
                      </div>
                      {active && <span className="your-turn">轮到你了</span>}
                    </div>
                    <div className="phase-actions">
                      {viewed.phase === "turn" && !godMode && (
                        <div className="action-buttons">
                          <button
                            className="primary"
                            disabled={
                              !active ||
                              godMode ||
                              !available.some((a) => a.type === "draw")
                            }
                            onClick={() => commit({ type: "draw" })}
                          >
                            <span className="action-button-copy">
                              <b>抽取一块牌</b>
                              <small>探索未知</small>
                            </span>
                            <ArrowRight size={16} />
                          </button>
                          <button
                            className="secondary invoke"
                            disabled={!active || godMode}
                            onClick={() => commit({ type: "invoke" })}
                          >
                            <Glyph kind="ra" />
                            <span className="action-button-copy">
                              <b>呼唤 RA</b>
                              <small>发起拍卖</small>
                            </span>
                          </button>
                          <button
                            className={`secondary god-action ${godMode ? "chosen" : ""}`}
                            disabled={
                              !active ||
                              !available.some((a) => a.type === "god")
                            }
                            onClick={() => {
                              setGodMode((g) => !g);
                              setSelectedTiles([]);
                            }}
                          >
                            <Glyph kind="god" />
                            <span className="action-button-copy">
                              <b>{godMode ? "取消交换" : "使用神祇"}</b>
                              <small>换取指定拍品</small>
                            </span>
                          </button>
                        </div>
                      )}
                      {viewed.phase === "turn" && !godMode && (
                        <div className="turn-action-hint">
                          {available.some((a) => a.type === "god")
                            ? "持有神祇：点击“使用神祇”后，选择一块非神祇拍品交换。"
                            : "抽牌增加拍品，或呼唤 RA 发起整批拍卖。"}
                        </div>
                      )}
                      {(viewed.phase === "god" || godMode) && (
                        <div className="selection-action god-selection">
                          <span>
                            {exchangeValid
                              ? `已选择${tileName(viewed.market.find((t) => t.id === selectedTiles[0])!)}，以一块神祇交换。`
                              : "点击拍品选择要换取的牌，默认换完自动结束回合。"}
                          </span>
                          <div className="god-selection-buttons">
                            <button
                              className="primary god-confirm"
                              disabled={!active || !exchangeValid}
                              onClick={() =>
                                commit(
                                  { type: "god", tileId: selectedTiles[0] },
                                  true,
                                )
                              }
                            >
                              <Check size={18} />
                              交换并结束回合
                            </button>
                            {canContinueExchange && (
                              <button
                                className="secondary"
                                disabled={!active || !exchangeValid}
                                onClick={() =>
                                  commit({
                                    type: "god",
                                    tileId: selectedTiles[0],
                                  })
                                }
                              >
                                交换后继续
                              </button>
                            )}
                            {viewed.phase === "god" ? (
                              <button
                                className={`${exchangeValid ? "secondary" : "primary"} god-finish`}
                                disabled={!active}
                                onClick={() => commit({ type: "finish" })}
                              >
                                结束回合
                                <ArrowRight size={18} />
                              </button>
                            ) : (
                              <button
                                className="secondary"
                                disabled={!active}
                                onClick={() => {
                                  setGodMode(false);
                                  setSelectedTiles([]);
                                }}
                              >
                                取消交换
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {viewed.phase === "auction" && (
                        <>
                          <div
                            className="bid-history"
                            role="group"
                            aria-label="拍卖出价记录"
                            style={{
                              gridTemplateColumns: `repeat(${viewed.auction!.order.length}, minmax(0, 104px))`,
                            }}
                          >
                            {viewed.auction!.order.map((i) => {
                              const bid = viewed.auction!.bids.find(
                                (b) => b.player === i,
                              );
                              return (
                                <span
                                  key={i}
                                  data-motion={`bid-${i}`}
                                  className={`${bid?.sun ? "has-bid" : ""} ${viewed.current === i ? "now" : ""} ${bid?.sun && bid.sun === viewed.auction!.high ? "highest-bid" : ""} ${latestMove?.actor === i && ["bid", "pass"].includes(latestMove.kind) ? "just-bid" : ""}`}
                                >
                                  <span className="bid-player-name">
                                    {viewed.players[i].name}
                                  </span>
                                  {bid?.sun &&
                                  bid.sun === viewed.auction!.high ? (
                                    <em>最高</em>
                                  ) : null}
                                  <b>
                                    {bid
                                      ? (bid.sun ?? "弃权")
                                      : viewed.current === i
                                        ? "出价中"
                                        : "等待"}
                                  </b>
                                </span>
                              );
                            })}
                          </div>
                          <div className="bid-controls">
                            <div className="sun-choices">
                              {[...actor!.suns]
                                .sort((a, b) => a - b)
                                .map((n) => (
                                  <Disk
                                    key={n}
                                    value={n}
                                    selected={selectedSun === n}
                                    disabled={
                                      !active || n <= viewed.auction!.high
                                    }
                                    onClick={() => setSelectedSun(n)}
                                  />
                                ))}
                            </div>
                            <div className="bid-buttons">
                              <button
                                className="secondary"
                                disabled={!active || mustBid(viewed)}
                                onClick={() =>
                                  commit({ type: "bid", sun: null })
                                }
                              >
                                放弃出价
                              </button>
                              <button
                                className="primary"
                                disabled={
                                  !active ||
                                  selectedSun === null ||
                                  selectedSun <= viewed.auction!.high
                                }
                                onClick={() =>
                                  commit({ type: "bid", sun: selectedSun })
                                }
                              >
                                出价 {selectedSun ?? "—"} <Check size={16} />
                              </button>
                            </div>
                          </div>
                          {mustBid(viewed) && (
                            <p className="hint">
                              你主动呼唤
                              Ra，且其他人都已弃权：必须选择一枚圆盘出价。
                            </p>
                          )}
                        </>
                      )}
                      {viewed.phase === "disaster" && (
                        <>
                          <div className="disaster-tiles">
                            {eligibleDiscards(viewed).map((t) => (
                              <Tile
                                key={t.id}
                                tile={t}
                                onClick={() => toggleTile(t.id)}
                                selected={selectedTiles.includes(t.id)}
                                disabled={!active}
                              />
                            ))}
                          </div>
                          <div className="selection-action">
                            <span>
                              已选择 {selectedTiles.length} /{" "}
                              {requiredDiscards(viewed)} 块
                            </span>
                            <button
                              className="primary"
                              disabled={!active || !discardValid}
                              onClick={() =>
                                commit({ type: "discard", ids: selectedTiles })
                              }
                            >
                              确认弃置 <Check size={16} />
                            </button>
                          </div>
                        </>
                      )}
                      {(viewed.phase === "epoch" ||
                        viewed.phase === "over") && (
                        <button
                          className="primary"
                          onClick={() =>
                            screen === "replay"
                              ? setModal("log")
                              : setResultDismissed("")
                          }
                        >
                          查看纪元结算 <ArrowRight size={16} />
                        </button>
                      )}
                      {aiError && (
                        <div className="error-banner">
                          {aiError}
                          <button
                            onClick={() => {
                              setAiError("");
                              setRetry((n) => n + 1);
                            }}
                          >
                            重试
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                  <PlayerMat
                    state={viewed}
                    player={inspect}
                    onPlayer={viewPlayer}
                    unread={unreadAcquisitions}
                    bidding={
                      viewed.phase === "auction" && inspect === viewed.current
                        ? {
                            enabled: active,
                            high: viewed.auction!.high,
                            selected: selectedSun,
                            onSelect: setSelectedSun,
                            onBid: (sun) => commit({ type: "bid", sun }),
                          }
                        : undefined
                    }
                    onHome={
                      viewed.config.humans === 1 && inspect !== 0
                        ? () => viewPlayer(0)
                        : undefined
                    }
                    latest={latestMove}
                  />
                </div>
                <aside className="table-sidebar">
                  <section className="player-strip" aria-label="所有玩家">
                    {viewed.players.map((p, i) => (
                      <button
                        key={i}
                        data-motion={`player-${i}`}
                        className={`player-summary ${viewed.current === i ? "current" : ""} ${inspect === i ? "inspected" : ""} ${(latestMove?.winner ?? latestMove?.actor) === i ? "just-acted" : ""} ${viewed.auction?.caller === i ? "is-auction-caller" : ""}`}
                        onClick={() => viewPlayer(i)}
                      >
                        <AuctionCallerBadge state={viewed} player={i} />
                        <span className={`avatar avatar-${i}`}>
                          <Glyph kind="pharaoh" />
                        </span>
                        <div className="player-meta">
                          <b>
                            {p.name} <small>{p.human ? "玩家" : "AI"}</small>
                            {unreadAcquisitions[i] && (
                              <small className="unread-acquisition">
                                新收获
                              </small>
                            )}
                          </b>
                          <span
                            className={
                              (latestMove?.winner ?? latestMove?.actor) === i
                                ? "last-action-tag"
                                : ""
                            }
                          >
                            {(latestMove?.winner ?? latestMove?.actor) === i
                              ? latestMove!.title.replace(p.name, "刚刚 · ")
                              : p.suns.length
                                ? `${p.suns.length} 枚圆盘可用`
                                : "本纪元已休息"}
                          </span>
                        </div>
                        <div className="mini-disks">
                          {[...p.suns]
                            .sort((a, b) => a - b)
                            .map((n) => (
                              <span key={n} data-motion={`sun-${i}-${n}`}>
                                {n}
                              </span>
                            ))}
                          {p.used.map((n) => (
                            <span
                              className="used"
                              key={n}
                              data-motion={`sun-${i}-${n}`}
                              role="img"
                              aria-label={
                                viewed.phase === "over"
                                  ? `太阳圆盘 ${n}`
                                  : "暗扣圆盘，本纪元不可用"
                              }
                              title={
                                viewed.phase === "over"
                                  ? `太阳圆盘 ${n}`
                                  : "暗扣圆盘；自己的可到玩家板点击查看"
                              }
                            >
                              {viewed.phase === "over" ? n : "☼"}
                            </span>
                          ))}
                        </div>
                        {viewed.current === i && <span className="turn-dot" />}
                      </button>
                    ))}
                  </section>
                  {acquisition && (
                    <AcquisitionNotice
                      move={acquisition[1]}
                      name={viewed.players[Number(acquisition[0])].name}
                      onDetails={() => {
                        setMoveInfo(acquisition[1]);
                        setModal("move");
                        acknowledgeAcquisition(Number(acquisition[0]));
                      }}
                      onBoard={() => viewPlayer(Number(acquisition[0]))}
                      onDismiss={() =>
                        acknowledgeAcquisition(Number(acquisition[0]))
                      }
                    />
                  )}
                  <section className="score-card">
                    <span className="eyebrow">YOUR LEGACY</span>
                    <h3>王朝的声望</h3>
                    <div className="score-big">
                      {reveal === inspect ||
                      viewed.phase === "over" ||
                      (viewed.config.humans === 1 && inspect === 0)
                        ? inspecting!.score
                        : "—"}
                      <small>分</small>
                    </div>
                    {!(viewed.config.humans === 1 && inspect === 0) &&
                      viewed.phase !== "over" && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setReveal((r) => (r === inspect ? null : inspect))
                          }
                        >
                          {reveal === inspect ? "隐藏分数" : "点击查看分数"}
                        </button>
                      )}
                    <div className="score-estimate">
                      <span>本纪元当前预计</span>
                      <b>
                        {estimate[inspect]?.delta >= 0 ? "+" : ""}
                        {estimate[inspect]?.delta}
                      </b>
                    </div>
                    <p>预计值随法老多数与新拍品变化。古迹在第三纪元计分。</p>
                  </section>
                  <ActionFeed
                    moves={moves}
                    state={viewed}
                    stepMode={stepMode}
                    onStepMode={() => {
                      setStepMode((v) => !v);
                      setWaiting(false);
                    }}
                    waiting={waiting}
                    onContinue={() => setWaiting(false)}
                    onInspect={(move) => {
                      setMoveInfo(move);
                      setModal("move");
                    }}
                    onLog={() => setModal("log")}
                  />
                </aside>
              </div>
              <footer>
                <span>
                  第 {viewed.epoch} 纪元 · 第 {viewed.steps} 步 ·{" "}
                  {DIFFICULTIES[viewed.config.difficulty]}
                </span>
                <span>
                  每步自动保存 · 参考 25th Century Games 版图{" "}
                  <span className="save-dot">●</span>
                </span>
              </footer>
            </main>
          </div>
        )
      )}
      {motion && screen === "game" && (
        <ActionMotion
          key={motion.id}
          motion={motion}
          paused={paused || !!modal}
          onDone={() => setMotion(null)}
        />
      )}
      {modal === "move" && moveInfo && (
        <Dialog title={moveInfo.title} onClose={() => setModal(null)}>
          <p className="move-detail-text">{moveInfo.detail}</p>
          <div className="move-detail-tiles">
            {moveInfo.tiles.map((t) => (
              <div key={t.id}>
                <TileArt kind={t.kind} variant={t.variant} />
                <b>{tileName(t)}</b>
              </div>
            ))}
          </div>
          <p className="muted">
            第 {moveInfo.step} 步 · 查看时电脑已暂停，关闭后继续。
          </p>
        </Dialog>
      )}
      {modal === "tile" && tileInfo && (
        <Dialog title="牌的功能与计分" onClose={() => setModal(null)}>
          <TileDetails tile={tileInfo} state={viewed} player={inspect} />
        </Dialog>
      )}
      {modal === "rules" && (
        <Dialog title="太阳神的法则" onClose={() => setModal(null)} wide>
          <Rules />
        </Dialog>
      )}
      {modal === "new" && (
        <Dialog title="开启一段新的王朝" onClose={() => setModal(null)}>
          <p className="muted">设置牌桌，让故事从尼罗河畔开始。</p>
          <div className="setup-form">
            <div className="setup-field">
              <span>统治者人数</span>
              <div className="segmented" role="group" aria-label="统治者人数">
                {[2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={count === n ? "selected" : ""}
                    aria-pressed={count === n}
                    onClick={() => {
                      setCount(n);
                      setHumans((h) => Math.min(h, n));
                    }}
                  >
                    {n} 人
                  </button>
                ))}
              </div>
            </div>
            <label>
              真人玩家
              <select
                value={humans}
                onChange={(e) => setHumans(+e.target.value)}
              >
                {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1
                      ? "1 人 · 与电脑对弈"
                      : n === count
                        ? `${n} 人 · 同屏好友对局`
                        : `${n} 人 · 其余由电脑加入`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              电脑难度
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                {Object.entries(DIFFICULTIES).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="field-note">
                入门适合熟悉规则；标准推演整轮拍卖；进阶每次决策思考约 2
                秒，模拟后续局势。
              </span>
            </label>
            {save && (
              <div className="notice">
                开启新王朝会替换自动存档。可以先到设置导出当前比赛。
              </div>
            )}
            <button className="primary full" onClick={start}>
              让太阳升起 <ArrowRight size={18} />
            </button>
          </div>
        </Dialog>
      )}
      {modal === "settings" && (
        <Dialog title="神庙里的片刻" onClose={() => setModal(null)}>
          <div className="setup-form">
            <label>
              电脑行动速度
              <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
                <option value={350}>迅速 · 0.35 秒</option>
                <option value={1000}>从容 · 1 秒</option>
                <option value={2000}>沉思 · 2 秒</option>
              </select>
            </label>
            <label className="toggle-row">
              行动音效
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => setSound(e.target.checked)}
              />
            </label>
            <div className="settings-actions">
              <button
                className="secondary"
                disabled={!save}
                onClick={() => save && downloadSave(save)}
              >
                <Download size={16} />
                导出存档
              </button>
              <button
                className="secondary"
                disabled={importing}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={16} />
                {importing ? "验证中…" : "导入存档"}
              </button>
              <button
                className="secondary"
                disabled={!save?.actions.length}
                onClick={enterReplay}
              >
                <History size={16} />
                对局回放
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setModal(null);
                  setScreen("menu");
                }}
              >
                <Home size={16} />
                返回主菜单
              </button>
            </div>
            <p className="muted">
              存档保存在此浏览器。导入会先逐步重放验证，成功后暂停在恢复的局面。
            </p>
          </div>
        </Dialog>
      )}
      {modal === "log" && viewed && (
        <Dialog title="尼罗河纪事" onClose={() => setModal(null)} wide>
          <div className="log-controls">
            <span className="muted">
              共 {viewed.log.length} 条 · 第 {viewed.epoch} 纪元
            </span>
            <button
              className="text-button"
              disabled={!save?.actions.length}
              onClick={enterReplay}
            >
              <Play size={15} />
              查看回放
            </button>
          </div>
          <div className="full-log">
            {viewed.log.map((line, i) => (
              <div key={i}>
                <span>{String(i + 1).padStart(3, "0")}</span>
                <p>{line}</p>
              </div>
            ))}
          </div>
          {viewed.history.map((rows, i) => (
            <div className="history-result" key={i}>
              <h3>第 {i + 1} 纪元</h3>
              {rows.map((r, j) => (
                <p key={j}>
                  {r.name}
                  <b>
                    {r.delta >= 0 ? "+" : ""}
                    {r.delta}
                  </b>
                </p>
              ))}
            </div>
          ))}
        </Dialog>
      )}
      {showResult && viewed && (
        <Dialog
          title={
            viewed.phase === "over"
              ? "终局排名 · 最终结算"
              : `第 ${viewed.epoch} 纪元 · 王朝结算`
          }
          onClose={() => setResultDismissed(resultKey)}
          wide
          className="result-dialog"
        >
          <div className="result-details">
            <div className="result-intro">
              <Sun />
              {viewed.phase === "over" ? (
                <>
                  <span className="eyebrow">THE SUN HAS CHOSEN</span>
                  <h3>
                    {viewed.players[ranking(viewed)[0].player].name}以{" "}
                    {ranking(viewed)[0].score} 分获得冠军
                  </h3>
                  <p>最终同分时，以持有的最大太阳圆盘决胜。</p>
                </>
              ) : (
                <p>太阳落下，文明留下了自己的印记。</p>
              )}
            </div>
            <ScoreBoard state={viewed} player={inspect} onPlayer={viewPlayer} />
            <p className="muted">
              {viewed.phase === "over"
                ? "三个纪元已结束。可以导出存档或回放这场王朝竞逐。"
                : "进入下纪元后保留古迹、法老和尼罗河；其他牌弃置，所有太阳圆盘重新可用。"}
            </p>
          </div>
          <div className="result-actions">
            <button
              className="secondary"
              onClick={() => setResultDismissed(resultKey)}
            >
              查看牌桌
            </button>
            {viewed.phase === "over" ? (
              <button
                className="primary"
                onClick={() => {
                  setResultDismissed(resultKey);
                  setModal("new");
                }}
              >
                <RotateCcw size={16} />
                再启王朝
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => commit({ type: "next" })}
              >
                进入第 {viewed.epoch + 1} 纪元 <ArrowRight size={17} />
              </button>
            )}
          </div>
        </Dialog>
      )}
    </TileInfoContext.Provider>
  );
}
export default App;
