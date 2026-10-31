import type { Action, Config, Save } from "./types.ts";
import { advance, newGame, validateConfig } from "./engine.ts";
export const SAVE_KEY = "ra-sun-god-save-v1";
export function createSave(config: Config): Save {
  return { version: 1, config, actions: [] };
}
export function replay(save: Save, limit = save.actions.length) {
  let state = newGame(save.config);
  for (const a of save.actions.slice(0, limit)) state = advance(state, a);
  return state;
}
export function parseSave(raw: string): Save {
  if (raw.length > 5_000_000) throw new Error("存档文件过大");
  const data = JSON.parse(raw);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.actions) ||
    data.actions.length > 20000
  )
    throw new Error("不支持的存档格式");
  validateConfig(data.config);
  const save: Save = {
    version: 1,
    config: { ...data.config },
    actions: data.actions as Action[],
  };
  replay(save);
  return save;
}
export function downloadSave(save: Save) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(save, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `ra-纪元存档-${save.config.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
