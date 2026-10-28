# C++ / WebAssembly 提速验证

2026-10-25。进阶 Worker 已接入 C++ / WebAssembly。规则模拟、计分、估值、拍卖求解与信息集 MCTS 都在 Wasm 中运行；JS 每次搜索只传入一次状态、读取一次结果。默认预算及策略参数保持不变。

## 同局面、同预算对照

种子 9502–9505，对 2–5 人各从三个纪元收集两个公开局面，共 24 个。先预热，再交替运行 TypeScript 与 Wasm；两者都包含公开信息处理，Wasm 还包含边界编码、解码及返回行动合法性检查。每个根候选对应 32 次总预算，两版合计模拟次数均为 1,920。

| 后端 | 搜索总耗时 | 中位数 | P95 |
| --- | ---: | ---: | ---: |
| TypeScript | 4327.4 ms | 127.6 ms | 350.2 ms |
| C++ / Wasm | 1330.8 ms | 39.6 ms | 120.0 ms |

整体搜索速度约为原来的 **3.25 倍**，总耗时减少约 **69.2%**。24 个局面的行动、访问分配、模拟步数及树节点数一致，候选均值按 1e-9 容差比较。

Wasm 文件 90,923 字节，生产构建 gzip 约 40 kB。此次模块实例化单独测得约 0.32 ms；首轮 JIT、网络下载、Worker 创建及界面动画/固定思考停顿不属于上述预热后的搜索耗时。该结果只代表本机和这批局面，不是所有设备的速度保证。

## 验证覆盖

- 既有 37 项回归检查通过，包括原有全对局牌与圆盘守恒检查。
- 新增 6 项原生检查通过：12 场完整比赛逐步比较合法行动、真实牌序、拍卖、分数和状态；冻结局面比较拍卖策略与 MCTS 树；验证隐藏信息隔离、确定性、不修改源状态、非法预算/行动；用原生 AI 经真实 TS 引擎跑完 2–5 人四场三纪元比赛。
- 4 项生产 Worker 检查通过：使用 Vite 实际构建产物及临时本地 HTTP 服务，验证带哈希 Wasm 资源加载、返回后端为 wasm、资源失败回退、入门/标准不下载 Wasm，以及下载停滞时的 5 秒超时回退。
- 完整回归命令通过；加载超时改动后另行定向重跑生产 Worker 检查，通过。TypeScript 检查及最终 Vite 生产构建通过。
- 命令行 `npm run simulate -- 1 hard` 已使用 C++ 跑完一场三人比赛，共 291 步。

## 交付范围

C++ 源码：`native/ra_ai.cpp`。产物：`src/game/ai/ra-ai.wasm`。ABI 与加载桥：`src/game/ai/wasm.ts`。源码和产物哈希记录在 `native/wasm-build.json`，普通构建、测试和模拟前验证，修改 C++ 后必须重新编译。普通前端/Docker 构建直接使用随源码保存的二进制，不需要 C++ 编译器。

实际牌桌、UI、存档与回放保持由 TypeScript 引擎管理；进阶 Worker 使用 C++，失败时有可诊断的 TypeScript 回退。同步 `chooseAction` 保留为参考与回退入口，命令行 hard 模拟也已切换 Wasm。此次是计算提速，不用它推断胜率提高；界面原有动画节奏保持不变。

## 复现

```bash
npm run build:wasm
npm run verify:wasm
npm test
npm run build
npm run benchmark:wasm -- artifacts/ai-wasm-benchmark.json
npm run simulate -- 1 hard
```

完整逐局面记录：`ai-wasm-benchmark.json`。工具链、缓存处理和数值协议见 `../native/README.md`。
