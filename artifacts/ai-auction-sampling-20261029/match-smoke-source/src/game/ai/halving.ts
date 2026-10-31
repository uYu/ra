// Sequential Halving at the root, UCT below it (Pepels et al., 2014).
// A wall-time search uses the restart/doubling schedule of Sagers et al., 2024.
// Neither schedule depends on Ra's scoring rules or tile types.
export class RootHalving {
  active: number[];
  private count: number;
  private budget: number;
  private timed: boolean;
  private quota: number;
  private roundUsed = 0;
  private used = 0;
  constructor(count: number, budget: number, timed: boolean) {
    this.count = count;
    this.budget = budget;
    this.timed = timed;
    this.active = Array.from({ length: count }, (_, i) => i);
    this.quota = timed
      ? 1
      : Math.max(1, Math.floor(budget / (Math.ceil(Math.log2(count)) * count)));
  }
  choose() {
    return this.active[this.roundUsed % this.active.length];
  }
  record(means: number[]) {
    this.used++;
    if (++this.roundUsed < this.quota * this.active.length) return;
    this.active.sort((a, b) => means[b] - means[a] || a - b);
    this.active = this.active.slice(0, Math.ceil(this.active.length / 2));
    this.roundUsed = 0;
    if (this.timed) {
      if (this.active.length === 1) {
        this.active = Array.from({ length: this.count }, (_, i) => i);
        this.quota = 1;
      } else this.quota *= 2;
    } else {
      const rounds = Math.max(1, Math.ceil(Math.log2(this.active.length)));
      this.quota = Math.max(
        1,
        Math.floor((this.budget - this.used) / (rounds * this.active.length)),
      );
    }
  }
  best(means: number[]) {
    const choices = this.timed
      ? Array.from({ length: this.count }, (_, i) => i)
      : this.active;
    return [...choices].sort((a, b) => means[b] - means[a] || a - b)[0];
  }
}
