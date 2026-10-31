import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { State, Save } from "../../src/game/types.ts";
import type { SearchReport } from "../../src/game/ai/search.ts";
import { ranking } from "../../src/game/engine.ts";
import { replay } from "../../src/game/storage.ts";
export type Decision = {
  step: number;
  player: number;
  epoch: number;
  phase: State["phase"];
  elapsedMs: number;
  report: SearchReport;
};
export type Trace = Save & {
  audit: {
    metadata: Record<string, unknown>;
    decisions: Decision[];
    ranking: ReturnType<typeof ranking>;
    history: State["history"];
    actionsSha256: string;
  };
};
export function recorder(config: State["config"]) {
  const decisions: Decision[] = [];
  return {
    record(s: State, report: SearchReport, elapsedMs: number) {
      decisions.push({
        step: s.steps + 1,
        player: s.current,
        epoch: s.epoch,
        phase: s.phase,
        elapsedMs,
        report,
      });
    },
    finish(s: State, metadata: Record<string, unknown>): Trace {
      const actions = decisions.map((d) => d.report.action);
      if (actions.length !== s.steps || s.phase !== "over")
        throw new Error("Incomplete trace");
      const save: Save = { version: 1, config, actions };
      const restored = replay(save);
      if (JSON.stringify(restored) !== JSON.stringify(s))
        throw new Error("Replay differs from real game");
      return {
        ...save,
        audit: {
          metadata,
          decisions,
          ranking: ranking(s),
          history: s.history,
          actionsSha256: createHash("sha256")
            .update(JSON.stringify(actions))
            .digest("hex"),
        },
      };
    },
  };
}
export async function saveTrace(path: string, trace: Trace) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(trace) + "\n");
  await rename(path + ".tmp", path);
}
