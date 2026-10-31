export type Choice = { action: string; probability: number };
export interface Game<S> {
  players: number;
  initial(): S;
  actor(s: S): number; // -1 chance, -2 terminal
  actions(s: S): string[];
  next(s: S, a: string): S;
  info(s: S, player: number): string;
  chance(s: S): Choice[];
  utility(s: S): number[];
}
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(ps: number[], random: () => number) {
  let x = random();
  for (let i = 0; i < ps.length - 1; i++) {
    x -= ps[i];
    if (x < 0) return i;
  }
  return ps.length - 1;
}
type Row = {
  actions: string[];
  regrets: number[];
  average: number[];
  visits: number;
};
export type Policy<S> = (s: S, actions: string[]) => number[];
export class MCCFR<S> {
  rows = new Map<string, Row>();
  iterations = 0;
  nodes = 0;
  random: () => number;
  game: Game<S>;
  constructor(game: Game<S>, seed = 1) {
    this.game = game;
    this.random = rng(seed);
  }
  row(s: S) {
    const actions = this.game.actions(s),
      key = this.game.info(s, this.game.actor(s));
    let row = this.rows.get(key);
    if (!row) {
      row = {
        actions,
        regrets: actions.map(() => 0),
        average: actions.map(() => 0),
        visits: 0,
      };
      this.rows.set(key, row);
    }
    if (row.actions.join("|") !== actions.join("|"))
      throw Error("Inconsistent information set action ordering");
    return row;
  }
  distribution(row: Row) {
    const positive = row.regrets.map((x) => Math.max(0, x)),
      total = positive.reduce((a, b) => a + b, 0);
    return positive.map((x) => (total ? x / total : 1 / positive.length));
  }
  policy: Policy<S> = (s, actions) => {
    const row = this.rows.get(this.game.info(s, this.game.actor(s)));
    const total = row?.average.reduce((a, b) => a + b, 0) ?? 0;
    return total
      ? row!.average.map((x) => x / total)
      : actions.map(() => 1 / actions.length);
  };
  train(iterations: number) {
    for (let t = 0; t < iterations; t++) {
      for (let player = 0; player < this.game.players; player++)
        this.walk(this.game.initial(), player, 1, 1);
      this.iterations++;
    }
  }
  walk(
    s: S,
    player: number,
    ownReach: number,
    sampleReach: number,
    cfWeight = 1,
  ): number {
    this.nodes++;
    const actor = this.game.actor(s);
    if (actor === -2) return this.game.utility(s)[player];
    if (actor === -1) {
      const options = this.game.chance(s),
        j = pick(
          options.map((x) => x.probability),
          this.random,
        );
      return this.walk(
        this.game.next(s, options[j].action),
        player,
        ownReach,
        sampleReach * options[j].probability,
        cfWeight,
      );
    }
    const row = this.row(s),
      ps = this.distribution(row);
    if (actor !== player) {
      // Full support is needed to estimate average strategies even behind an
      // opponent action whose CURRENT strategy probability has fallen to zero.
      const proposal = ps.map((p) => 0.9 * p + 0.1 / ps.length),
        j = pick(proposal, this.random);
      const ratio = ps[j] / proposal[j];
      return (
        ratio *
        this.walk(
          this.game.next(s, row.actions[j]),
          player,
          ownReach,
          sampleReach * proposal[j],
          cfWeight * ratio,
        )
      );
    }
    // Enumerate updater actions; correct both sampled prefixes and suffixes.
    const values = row.actions.map((a, j) =>
      this.walk(
        this.game.next(s, a),
        player,
        ownReach * ps[j],
        sampleReach,
        cfWeight,
      ),
    );
    const value = values.reduce((v, x, j) => v + x * ps[j], 0);
    for (let j = 0; j < ps.length; j++) {
      row.regrets[j] += cfWeight * (values[j] - value);
      // Unbiased full-history average-strategy contribution. Unlike the
      // common two-player shortcut this corrects ALL sampled players/chance.
      // Exact-zero own-reach histories contribute zero, not Infinity/NaN.
      row.average[j] += (ownReach / sampleReach) * ps[j];
    }
    row.visits++;
    return value;
  }
}
export function evaluate<S>(
  game: Game<S>,
  policy: Policy<S>,
  s = game.initial(),
): number[] {
  const actor = game.actor(s);
  if (actor === -2) return game.utility(s);
  const actions =
    actor === -1 ? game.chance(s).map((x) => x.action) : game.actions(s);
  const ps =
    actor === -1
      ? game.chance(s).map((x) => x.probability)
      : policy(s, actions);
  const out = Array(game.players).fill(0);
  actions.forEach((a, j) => {
    if (ps[j])
      evaluate(game, policy, game.next(s, a)).forEach(
        (v, i) => (out[i] += ps[j] * v),
      );
  });
  return out;
}
// Exact information-set best response. Hidden histories in an information set
// share one action; aggregating their counterfactual reach avoids clairvoyance.
export function bestResponse<S>(
  game: Game<S>,
  policy: Policy<S>,
  player: number,
) {
  type Node = {
    s: S;
    reach: number;
    actions: string[];
    ps: number[];
    children: Node[];
    value?: number;
  };
  const groups = new Map<string, Node[]>();
  let nodes = 0;
  function build(s: S, reach: number): Node {
    if (++nodes > 3_000_000) throw Error("Exact best-response tree cap");
    const actor = game.actor(s),
      actions =
        actor === -2
          ? []
          : actor === -1
            ? game.chance(s).map((x) => x.action)
            : game.actions(s);
    const ps =
      actor === -2
        ? []
        : actor === -1
          ? game.chance(s).map((x) => x.probability)
          : policy(s, actions);
    const n: Node = { s, reach, actions, ps, children: [] };
    if (actor === player) {
      const key = game.info(s, player),
        g = groups.get(key) ?? [];
      g.push(n);
      groups.set(key, g);
    }
    n.children = actions.map((a, j) =>
      build(game.next(s, a), reach * (actor === player ? 1 : ps[j])),
    );
    return n;
  }
  const root = build(game.initial(), 1),
    chosen = new Map<string, number>();
  function value(n: Node): number {
    if (n.value !== undefined) return n.value;
    const actor = game.actor(n.s);
    if (actor === -2) return (n.value = game.utility(n.s)[player]);
    if (actor === player) {
      const key = game.info(n.s, player);
      if (!chosen.has(key)) {
        const totals = n.actions.map((_, j) =>
          groups
            .get(key)!
            .reduce((v, m) => v + m.reach * value(m.children[j]), 0),
        );
        chosen.set(key, totals.indexOf(Math.max(...totals)));
      }
      return (n.value = value(n.children[chosen.get(key)!]));
    }
    return (n.value = n.children.reduce(
      (v, c, j) => v + n.ps[j] * value(c),
      0,
    ));
  }
  return { value: value(root), nodes };
}
