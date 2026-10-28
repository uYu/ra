import { readFile } from "node:fs/promises";
import { createWasmAi } from "../src/game/ai/wasm.ts";
import { advance, newGame, ranking } from "../src/game/engine.ts";
import { chooseAction, observe } from "../src/game/ai.ts";
import type { Difficulty } from "../src/game/types.ts";
const rounds = Number(process.argv[2] ?? 20),
  difficulty = (process.argv[3] ?? "normal") as Difficulty;
const native =
  difficulty === "hard"
    ? await createWasmAi(
        await readFile(new URL("../src/game/ai/ra-ai.wasm", import.meta.url)),
      )
    : null;
let actions = 0;
const start = performance.now(),
  totals: number[] = [];
for (let seed = 1; seed <= rounds; seed++) {
  let s = newGame({ count: 2 + (seed % 4), humans: 0, difficulty, seed });
  while (s.phase !== "over" && s.steps < 1500)
    s = advance(
      s,
      native ? native.search(s).action : chooseAction(observe(s), difficulty),
    );
  if (s.phase !== "over") throw new Error(`Seed ${seed} did not finish`);
  actions += s.steps;
  totals.push(ranking(s)[0].score);
}
console.log(
  `${rounds} 场 ${difficulty}${native ? "（C++ / Wasm）" : ""} 完整对局通过；${actions} 步；胜者平均 ${(totals.reduce((a, b) => a + b, 0) / rounds).toFixed(1)} 分；耗时 ${((performance.now() - start) / 1000).toFixed(2)} 秒。`,
);
