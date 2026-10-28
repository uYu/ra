import { chooseAction } from "./ai.ts";
import { loadWasmAi } from "./ai/wasm.ts";
import type { Difficulty, State } from "./types.ts";

self.onmessage = async (
  e: MessageEvent<{ state: State; difficulty: Difficulty }>,
) => {
  const started = performance.now();
  try {
    if (e.data.difficulty === "hard") {
      try {
        const ai = await loadWasmAi();
        const action = ai.search(e.data.state).action;
        self.postMessage({
          action,
          elapsed: performance.now() - started,
          backend: "wasm",
        });
        return;
      } catch (error) {
        // Keep the game playable if WebAssembly is unavailable or its asset
        // cannot be loaded. Include diagnostics so fallback is observable.
        const action = chooseAction(e.data.state, "hard");
        self.postMessage({
          action,
          elapsed: performance.now() - started,
          backend: "typescript",
          fallback: error instanceof Error ? error.message : "Wasm 不可用",
        });
        return;
      }
    }
    const action = chooseAction(e.data.state, e.data.difficulty);
    self.postMessage({
      action,
      elapsed: performance.now() - started,
      backend: "typescript",
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "AI 计算失败",
    });
  }
};
