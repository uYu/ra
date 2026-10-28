export type Kind =
  | "monument"
  | "pharaoh"
  | "god"
  | "gold"
  | "civilization"
  | "nile"
  | "flood"
  | "ra"
  | "earthquake"
  | "funeral"
  | "war"
  | "drought";
export type Tile = { id: number; kind: Kind; variant: number };
export type Difficulty = "easy" | "normal" | "hard";
export type Config = {
  count: number;
  humans: number;
  difficulty: Difficulty;
  seed: number;
};
export type Player = {
  name: string;
  human: boolean;
  suns: number[];
  used: number[];
  tiles: Tile[];
  score: number;
};
export type ScoreRow = {
  name: string;
  parts: Record<string, number>;
  delta: number;
  total: number;
};
export type Auction = {
  caller: number;
  reason: "draw" | "invoke" | "full";
  order: number[];
  index: number;
  high: number;
  winner: number;
  bids: { player: number; sun: number | null }[];
};
export type State = {
  config: Config;
  epoch: number;
  phase: "turn" | "auction" | "disaster" | "god" | "epoch" | "over";
  players: Player[];
  current: number;
  bag: Tile[];
  market: Tile[];
  discarded: Tile[];
  center: number;
  ra: number;
  auction: Auction | null;
  pending: Tile[];
  resume: "turn" | "god";
  next: number;
  history: ScoreRow[][];
  log: string[];
  lastTile: Tile | null;
  steps: number;
};
export type Action =
  | { type: "draw" }
  | { type: "invoke" }
  | { type: "bid"; sun: number | null }
  | { type: "god"; tileId: number }
  | { type: "finish" }
  | { type: "discard"; ids: number[] }
  | { type: "next" };
export type Save = { version: 1; config: Config; actions: Action[] };
