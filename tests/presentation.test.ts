import test from "node:test";
import assert from "node:assert/strict";
import { advance, newGame } from "../src/game/engine.ts";
import {
  auctionNotice,
  auctionReceipt,
  describeMove,
  recentMoves,
} from "../src/game/presentation.ts";
import { RA_LIMIT } from "../src/game/data.ts";
import { chooseAction, observe } from "../src/game/ai.ts";
import type { Action, Save } from "../src/game/types.ts";
const setup = () =>
  newGame({ count: 3, humans: 1, difficulty: "normal", seed: 100 });
test("the Ra announcement retains its caller and cause across subsequent bids", () => {
  const before = setup();
  before.bag.push(
    ...before.bag.splice(
      before.bag.findIndex((tile) => tile.kind === "ra"),
      1,
    ),
  );
  const drawn = advance(before, { type: "draw" });
  const notice = auctionNotice(drawn);
  assert.equal(notice?.actor, before.current);
  assert.equal(notice?.kind, "ra");
  assert.ok(notice?.detail.includes("已弃置，不进入拍卖轨"));
  const next = advance(drawn, { type: "bid", sun: null });
  assert.deepEqual(
    auctionNotice(next, describeMove(drawn, { type: "bid", sun: null }, next)),
    notice,
  );
});
test("invoking Ra names the caller and explains that no tile was drawn and the boat does not move", () => {
  const before = setup();
  const after = advance(before, { type: "invoke" });
  const notice = auctionNotice(after);
  assert.equal(notice?.actor, before.current);
  assert.equal(notice?.kind, "invoke");
  assert.ok(notice?.title.includes(before.players[before.current].name));
  assert.ok(notice?.detail.includes("太阳船不前进"));
  assert.ok(notice?.detail.includes("没有抽取太阳神牌"));
});
test("the last Ra announces epoch scoring rather than an auction", () => {
  const before = setup();
  before.ra = RA_LIMIT[before.config.count] - 1;
  before.bag.push(
    ...before.bag.splice(
      before.bag.findIndex((tile) => tile.kind === "ra"),
      1,
    ),
  );
  const action = { type: "draw" } as const;
  const after = advance(before, action);
  const notice = auctionNotice(after, describeMove(before, action, after));
  assert.equal(notice?.status, "纪元结束 · 不拍卖");
  assert.ok(notice?.detail.includes("不再拍卖"));
  assert.equal(auctionNotice(advance(after, { type: "next" })), null);
});
test("draw presentation names the acting player and the revealed tile", () => {
  const before = setup(),
    after = advance(before, { type: "draw" }),
    m = describeMove(before, { type: "draw" }, after);
  assert.equal(m.actor, before.current);
  assert.equal(m.tiles[0].id, after.lastTile!.id);
  assert.ok(m.title.includes(before.players[before.current].name));
  assert.equal(m.step, 1);
});
test("last bidder passing still announces the previous bidder as winner and shows the entire lot", () => {
  let s = setup();
  s = advance(s, { type: "draw" });
  s = advance(s, { type: "invoke" });
  const winner = s.current,
    sun = s.players[winner].suns[0],
    lot = [...s.market],
    center = s.center;
  s = advance(s, { type: "bid", sun });
  s = advance(s, { type: "bid", sun: null });
  const a: Action = { type: "bid", sun: null };
  const after = advance(s, a),
    move = describeMove(s, a, after);
  assert.equal(move.kind, "win");
  assert.equal(move.actor, s.current);
  assert.equal(move.winner, winner);
  assert.deepEqual(move.tiles, lot);
  assert.ok(move.title.includes(s.players[winner].name));
  assert.ok(move.detail.includes(`换回已使用圆盘 ${center}`));
});
test("recent move reconstruction is bounded, chronological, and does not mutate the save", () => {
  let state = setup();
  const save: Save = { version: 1, config: state.config, actions: [] };
  for (let i = 0; i < 30; i++) {
    const a = chooseAction(observe(state));
    save.actions.push(a);
    state = advance(state, a);
  }
  const copy = structuredClone(save);
  const moves = recentMoves(save, 20, 5);
  assert.equal(moves.length, 5);
  assert.deepEqual(
    moves.map((m) => m.step),
    [16, 17, 18, 19, 20],
  );
  assert.deepEqual(save, copy);
});

test("auction receipt attributes a last-pass win to the earlier bidder and retains its entire lot", () => {
  let state = advance(setup(), { type: "draw" });
  state = advance(state, { type: "invoke" });
  const winner = state.current,
    paid = state.players[winner].suns[0],
    received = state.center;
  const lot = structuredClone(state.market);
  state = advance(state, { type: "bid", sun: paid });
  assert.equal(
    auctionReceipt(
      state,
      { type: "bid", sun: null },
      advance(state, { type: "bid", sun: null }),
    ),
    null,
  );
  state = advance(state, { type: "bid", sun: null });
  const action = { type: "bid", sun: null } as const;
  const after = advance(state, action);
  assert.deepEqual(auctionReceipt(state, action, after), {
    winner,
    paid,
    received,
    tiles: lot,
  });
  assert.equal(after.market.length, 0);
});
test("auction receipt uses the final bidder when they raise and supports a disk-only auction", () => {
  let state = advance(setup(), { type: "invoke" });
  state = advance(state, { type: "bid", sun: null });
  state = advance(state, { type: "bid", sun: null });
  const action = {
    type: "bid",
    sun: state.players[state.current].suns[0],
  } as const;
  const after = advance(state, action);
  assert.deepEqual(auctionReceipt(state, action, after), {
    winner: state.current,
    paid: action.sun,
    received: state.center,
    tiles: [],
  });
});
test("an all-pass auction and non-auction actions never announce a winner", () => {
  const before = setup(),
    action = { type: "draw" } as const;
  assert.equal(auctionReceipt(before, action, advance(before, action)), null);
  before.bag.push(
    ...before.bag.splice(
      before.bag.findIndex((t) => t.kind === "ra"),
      1,
    ),
  );
  let state = advance(before, action);
  state = advance(state, { type: "bid", sun: null });
  state = advance(state, { type: "bid", sun: null });
  const pass = { type: "bid", sun: null } as const;
  assert.equal(auctionReceipt(state, pass, advance(state, pass)), null);
});
