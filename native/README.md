# Ra AI 的 C++ / WebAssembly 核心

浏览器进阶 AI 使用 `ra_ai.cpp` 中的规则模拟、计分、局势估值、拍卖求解和信息集 MCTS。一次请求的所有模拟都在 Wasm 内执行，JS 只编码一次输入并读取一次结果。实际牌桌、界面、存档与回放继续由 TypeScript 引擎管理。

策略和默认预算保持与 TypeScript 参考一致：总预算为根候选数 × 32 次，UCT 自适应分配访问；共享根场景、递减策略引导、对手倾向采样和公开信息隔离均保留。此次迁移不据速度推断胜率提高。浮点估值按容差检查，不承诺跨运行时逐比特一致。

## 构建

仓库保留 `src/game/ai/ra-ai.wasm`，因此普通前端构建与 Docker 构建只需要 Node.js，不需要安装 C++ 工具链。

更改 C++ 后，需要 PATH 中有 Emscripten 的 `em++`，然后执行：

```bash
npm run build:wasm
npm run verify:wasm
npm test
npm run build
```

构建脚本使用临时目录中的 Emscripten 缓存，必要时复制现有只读缓存。也可通过 `EM_CACHE` 指定可写缓存，通过 `EMXX` 指定编译器。默认缓存路径先解析符号链接，避免 macOS `/var` 与 `/private/var` 的相对路径问题。

`wasm-build.json` 保存 ABI 版本、编译器、编译选项和源码/产物 SHA-256。普通构建、测试和命令行模拟会先验证，防止源码改动后误用旧二进制。更新规则时必须同步两套引擎、重新生成 Wasm 并运行一致性检查。

## 运行与回退

`src/game/ai.worker.ts` 在进阶难度加载 `wasm.ts`。Vite 将二进制打包为带哈希文件名的独立资源，加载路径相对于 Worker，支持相对部署路径。无需共享内存或跨源隔离配置。

加载失败、编译失败、返回非法行动或下载超过 5 秒时，Worker 回退到 TypeScript 搜索，并返回 `backend` 和 `fallback` 诊断字段。入门与标准难度直接使用 TypeScript，不加载 Wasm。暂停/弹窗取消仍通过终止当前 Worker 完成。

同步函数 `chooseAction()` 继续作为 TypeScript 参考与回退入口；浏览器进阶 Worker 和 `npm run simulate -- N hard` 使用 C++。性能对照命令：

```bash
npm run benchmark:wasm -- artifacts/ai-wasm-benchmark.json
```

这个对照包含 JS 状态编码、公开信息处理和结果解码，双方使用相同局面与模拟预算；模块首次实例化单独计时。它不包含 HTTP 下载、Worker 创建或界面动画/固定思考展示停顿。

## 数值协议

边界使用版本化的 Float64 数值缓冲区；状态中的整数通过数值传输。C++ 校验长度、索引范围、协议版本和预算，JS 在返回前再次确认行动合法性。内存增长后重新获取结果视图。

- 导出：`abi_version`、`input_ptr`、`output_ptr`、`run`，以及编译器的内存/初始化导出。
- ABI 6 的 `run(op, length, samples, horizon, variant, timeMs)`：0 搜索，1 单步规则模拟，2 估值/纪元得分，3 策略，4 合法行动，5 搜索候选，6 完整拍卖续着，7 价值模型特征/推理诊断，8 续局策略模型特征/评分诊断。搜索输入在状态后依次追加价值模型与续局模型块，最后追加奖励枚举（0 为默认 relative，1 为实验 future-rank）：0 表示不用该模型；1 后接输入维度、隐藏层大小和权重。价值模型为91维、最多48隐藏单元，续局模型为287维、最多16隐藏单元；缓冲区16384个Float64，支持两类模型的最大组合。续局模型权重须为有限数且绝对值不超过1e6。实验模型按调用传入，不保存为全局状态。`horizon` 为 0（本纪元）、1（终局）、2（本纪元及下一纪元）；`variant` 为 0（UCT）、1（根 SH）、2（DPW）；`timeMs=0` 使用固定模拟预算，非零使用软计算时限。状态缓冲区格式仍为版本 1。
- 只有搜索入口用于生产决策，调用前重新构造公开剩余牌集合、清除种子与隐藏分数。其余操作用于与 TS 参考逐状态比对，可以保留测试传入的袋序和分数。
- 原生模拟不生成中文日志或历史展示数据；一致性检查比较规则状态、牌序、拍卖过程与分数，展示数据由 TS 引擎产生。
- 等时搜索通过 WASI `clock_time_get` 读取桥接的单调时钟。模块初始化后赋值导出的内存引用，每次写时钟数据重新建立视图，以兼容内存增长。没有时间预算的调用保持确定性。

## 论文算法对照

TS 与 C++ 均支持 `variant: "uct" | "sh" | "dpw"`，默认仍为 UCT。`timeMs: 200` 表示在完整模拟之间检查 200 ms 软时限；最低根候选覆盖和最后一次模拟可能超时，不能假设返回耗时严格等于 200 ms。固定次数 SH 与等时 Anytime SH 使用不同的、分别有文献依据的调度。

固定预算、等时两种模式各自测试 SH、DPW，共四组；参数、引用和信息隔离方式见 [实验设计](../artifacts/ai-tree-methods.md)。

```sh
node --experimental-strip-types scripts/benchmark-budget-control.ts --variants sh,dpw --modes fixed,time --seeds 6 --start 14001 --time-ms 200 --jobs 8 --cost-source artifacts/ai-tree-40ms-stopped.json --out artifacts/ai-tree-rerun.json
```

## 跨纪元搜索验证

`search(state, { horizon: "next-epoch" })` 在每次模拟中继续执行纪元切换，直到下一纪元计分结束；从第二或第三纪元开始则模拟至终局。它使用原有估值、对手模型、UCT 和根候选数 × 32 次总预算，不增加针对特定牌的策略。转移上限为 480 步，搜索报告的 `truncated` 记录没有抵达目标的模拟数；默认 `epoch` 上限 240 步，完整 `game` 上限 720 步。每个拍卖续着内部也检查终止条件和步数上限。

独立验证使用固定的 12001–12006 种子，2–5 人分别轮换全部座位，每组 84 局；11001 起的种子留给单独的试验，不与验证集合混用。此次不根据验证结果调参。

本次验证结果公开后，12001–12006 就不再是新版本的未见数据。后续调参应使用试验集合，并用 `--start 13001` 等新范围另做最终验证，输出到新的结果文件；不要覆盖历史报告后宣称使用了新的独立验证。

```bash
# 同模拟预算：下一纪元 32 对本纪元 32
npm run benchmark:horizon -- --split validation --seeds 6 --counts 2,3,4,5 --jobs 3 --out artifacts/ai-next-epoch-validation.json
# 更多计算预算的对手：下一纪元 32 对本纪元 64
npm run benchmark:horizon -- --split validation --seeds 6 --counts 2,3,4,5 --opponent-samples 64 --jobs 3 --costs off --out artifacts/ai-next-epoch-budget-control.json
```

脚本使用多个计算线程并保存完整局面的逐局统计与进度检查点。并发对战耗时只作诊断；延迟比较取第一组启动前单独执行的 24 局面预热测试。两组均为固定模拟预算，64 次对手是耗时接近的额外对照，不能称为逐手严格等时。胜负按正式规则用最高圆盘打破同分；轮换座位的比赛共享种子，不能按每局独立计算统计置信度。

## 学习估值实验

`search(state, { timeMs: 200, valueModel })` 可在纪元边界使用小型网络预测剩余分数；未传模型时保留原估值。TS 参考和 C++ 推理共享输入定义，终局剩余分数为零，竞价/rollout 策略不变。训练、开发与最终对局按整局和种子隔离。协议见 [ai-value-methods.md](../artifacts/ai-value-methods.md)。

```sh
node --experimental-strip-types scripts/train-value.ts --train 2000 --dev 400 --jobs 2
node --experimental-strip-types scripts/benchmark-tree.ts --variants uct --modes time --model artifacts/ai-value-model.json --seeds 6 --start 40001 --jobs 8 --costs off --out artifacts/ai-value-validation.json
node --experimental-strip-types scripts/summarize-value.ts
```

预算单独对照使用冻结 ABI 3，避免后续模型开发改变参照：

```sh
node --experimental-strip-types scripts/benchmark-budget-control.ts --variants uct --modes time --opponent-fixed yes --seeds 6 --start 15001 --jobs 6 --costs off --out artifacts/ai-uct200-control.json
```

两项新对照已全部完成：预算组 27/84、学习估值组 23/84 次第一名；参考均为 24/84。未发现稳定提升，默认设置保留，见 [实测报告](../artifacts/ai-value-benchmark.md)。完整回归 57/57 通过，已训练模型的推理与隐藏信息检查另通过同一估值测试组。

## 学习模拟续局策略

`search(state, { timeMs:200, rolloutModel })` 只替换模拟中对手行动与扩展后的rollout行动；原树prior、候选、UCT和末端估值保持原样。训练使用冻结ABI4原UCT200的完整对局与根候选访问分布；教师源码/二进制见 `artifacts/frozen-uct4/`，ABI4桥接为 `wasm-frozen-uct4.ts`。未传模型的固定预算结果与冻结版精确匹配。

```sh
npm run collect:policy
npm run train:policy
npm run benchmark:policy -- --seeds 6 --start 71001 --jobs 8 --costs off --out artifacts/ai-policy-rerun.json
# 汇总原先保存的完整84局结果和逐步回放
npm run report:policy
```

试验协议见 [ai-policy-methods.md](../artifacts/ai-policy-methods.md)。此轮不重训估值模型。模仿准确率改善不直接代表棋力提高，默认启用与否以独立完整对局为依据。

学习续局模型已完成独立84局验证：第一名27/84，参考24/84，尚无稳定优势。默认保持原策略；详见 [完整报告](../artifacts/ai-policy-benchmark.md)。

## 当前研究状态

ABI6增加按调用传入的 `reward: "relative" | "future-rank"`，未传时保持原默认行为。future-rank只比较模拟新增分数与原未来估值的两两顺序，同分半分；搜索效用为2倍比例减1，未使用隐藏累计分数。该选项默认关闭，不能当作最终名次概率。

最新SH200复测完成280局，排名分51.1%（种子95%区间46.7%–55.3%）；排名奖励120局后按用户要求停止，500ms未运行。默认仍为UCT / 本纪元 / 根候选数×32 / 原奖励。当前状态见 [PROGRESS.md](../PROGRESS.md)，本说明中其他实验节为历史记录。
