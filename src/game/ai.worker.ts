import { chooseAction, hardSearchHorizon } from "./ai.ts";
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
        const searchStarted = performance.now();
        const report = ai.search(e.data.state, {
          timeMs: 2000,
          horizon: hardSearchHorizon,
        });
        self.postMessage({
          action: report.action,
          elapsed: performance.now() - started,
          searchElapsed: performance.now() - searchStarted,
          samples: report.samples,
          horizon: hardSearchHorizon,
          epochAdvances: report.epochAdvances,
          completed: report.completed,
          truncated: report.truncated,
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
          horizon: hardSearchHorizon,
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
