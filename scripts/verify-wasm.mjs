import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "native/wasm-build.json"), "utf8"),
);
const hash = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, path)))
    .digest("hex");
if (
  manifest.abi !== 6 ||
  hash(manifest.source) !== manifest.sourceSha256 ||
  hash(manifest.target) !== manifest.wasmSha256
)
  throw new Error(
    "Wasm AI 源码或二进制已变化，请运行 npm run build:wasm 后重试。",
  );
