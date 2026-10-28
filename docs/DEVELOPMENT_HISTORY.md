# 开发历史归档

2026-10-28 从原 README 归档，保留当时的功能说明、研究过程及复现命令。最新结论以 [当前进展](../PROGRESS.md) 为准；命令均从仓库根目录执行，历史实验不会自动重启。文中的“保存棋谱/数据”包含仅在本地保留的生成文件；当前提交范围以 `.gitignore` 和 [实验索引](../artifacts/README.md) 为准。

---

# RA · 太阳神

参考相邻 Jaipur 项目的 React + TypeScript 分层结构、中文桌游交互与本地运行方式，实现 Ra 基础版。2–5 人，支持一位真人对电脑、多人混合电脑、全真人同屏对局。三纪元完整流程，无需账号、后端或模型 API。

## 启动

需要 Node.js 22.13+。

```bash
npm ci
npm run dev -- --port 5174
```

打开 http://127.0.0.1:5174 。

```bash
npm test                      # 规则、信息隔离、存档和 36 场完整比赛
npm run simulate -- 100 hard  # 100 场 C++ / Wasm 进阶 AI 完整对局
npm run build                 # TypeScript 检查与静态生产构建
npm run preview -- --port 5174
```

`dist/` 可部署到静态服务器，Vite 使用相对资源路径，支持子目录部署。不支持双击 HTML 文件运行，需通过 HTTP 服务打开。

## 已实现

- 中文主菜单、2–5 人设置、随机分配正确的起始太阳圆盘组合、最高圆盘先手。
- 180 块基础版牌：40 古迹（8 种）、25 法老、25 文明（5 种）、25 尼罗河、12 洪水、8 神祇、5 黄金、30 Ra、10 灾难。
- 抽牌、主动呼唤 Ra、一次性按顺序出价、赢家取得整批牌并交换圆盘。败者保留出价圆盘，赢家换回圆盘本纪元不可用。
- 拍卖轨满时禁止抽牌，主动满轨拍卖全部弃权后清场；主动未满轨拍卖，其他人都弃权时发起者必须出价；抽到 Ra 全部弃权则保留拍品。
- 空拍卖轨也能呼唤 Ra；最后一位还有圆盘的玩家可继续行动；太阳轨道末格立即结算，不再拍卖。
- 神祇行动可连续交换多个非神牌，全部交换仍只占一个回合。交换灾难牌立即处理后可继续交换。
- 灾难从已有及新获牌中弃置对应两块，支持真人选择古迹、文明等目标。干旱强制先弃洪水，再弃尼罗河；不足两块时全部弃置。
- 三纪元全部计分，跨纪元保留古迹、法老和尼罗河，其他牌与拍卖轨残留弃置，不放回袋中。每纪元结算后累积总分最低为零。
- 第三纪元额外结算古迹多样性和同类集合，以及太阳圆盘总和；并列多数/少数完整计分，所有人相同时不计。终局同分比较持有的最大圆盘。
- 实体桌游布局：桌面右侧竖排玩家概览与操作播报，主区单排八块拍品，深蓝星空、金色柱廊与彩色牌块；玩家板以中央太阳圆盘分隔永久牌与临时牌。普通回合采用左侧回合信息、右侧三个等宽操作卡片的布局。左右共用四行轨道，古迹占两行，法老/文明与尼罗河/洪水分别对齐。
- 牌面采用“文明·文字”“古迹·神庙”等完整分类名；玩家板预印八种古迹和五种文明，未收集淡显，收集后点亮并标数量，上下使用相同图案。图标与名称上下分区，数量角标单独定位，出价阶段不再压缩玩家板。
- 鼠标悬停或键盘聚焦牌块/玩家板图标显示详细功能、计分、示例和持有数量；点击仍可展开完整说明。帮助弹窗会暂停电脑思考与回放。
- 玩家板内可用圆盘与出价区双向同步选择，可直接在玩家板确认出价；已使用、非当前玩家及不高于最高出价的圆盘不能出价。
- 抽牌、出价、成交取牌、圆盘交换、神祇换牌与灾难弃牌具有牌桌飞行动画。动画期间锁定行动并等待展示完成再启动下一手 AI；暂停/打开弹窗会暂停飞行，减少动态效果时改用静态标记。
- 最近抽取牌、最高出价、赢家收藏区和新获图案保留高亮与文字标记；成交后保留当前查看的玩家板，右侧以持久收获提醒和玩家角标提示，可查看收获详情或主动切换棋盘；查看对手时可一键返回自己的棋盘。主板底部显示醒目行动提示。
- 操作播报显示行动者、抽到/获得/弃掉的牌、竞价结果和圆盘交换。可逐步观看电脑行动，也可点击近期记录查看当步完整拍品。
- 八种古迹、四种灾难使用不同图形；玩家板显示类别规则、数量与当前计分条件。
- 版图结构和颜色参考 [Ian O’Toole 的官方设计展示](https://www.ianotoole.com/work/ra)，以本地 SVG 重绘，未直接使用出版版插画。
- 纪元和终局结算弹窗、逐类别计分明细、王国收藏、当前预估分、行动记录、暂停、规则、三档速度、可选音效。
- 自动存档、JSON 导入导出、完整行动回放（逐步、播放、进度条），设置偏好保存。
- 桌面双栏、手机双排拍品、键盘焦点与弹窗焦点约束、减少动态效果设置支持。
- 矢量画面在本地直接绘制，无外部图片、字体或 API 请求。

分数遵循规则以隐藏为默认：单人模式直接显示自己的总分，其他玩家默认隐藏，可点击查看，便于同屏记分与教学；终局公开全部总分。公开王国和当前预计得分始终可见。没有联网房间或远程多人模式。

## AI

进阶 AI 已使用 **C++ / WebAssembly**，整批规则模拟、估值、拍卖与 MCTS 在原生核心内完成。AI 在独立 Web Worker 中运行。打开规则、设置、日志，暂停或返回菜单时会终止当前 Worker，恢复时从当前状态重新计算。

Wasm 产物随源码保存，普通 `npm run build` 与 Docker 构建不需要 C++ 编译器；修改原生核心后执行 `npm run build:wasm`。构建会校验源码和 Wasm 哈希，加载失败时自动回退到 TypeScript。构建方式与边界说明见 [C++ 核心说明](../native/README.md)，本次对照见 [Wasm 验证记录](../artifacts/ai-wasm-benchmark.md)。

- **入门**：保留随机出价与探索，适合熟悉规则。
- **标准**：逐一推演整轮拍卖中所有后手的出价与弃权，按各玩家自己的收益选择应对；会考虑跳价封锁、中央圆盘交换、圆盘留用、纪元结束概率及对手得到拍品的收益。
- **进阶**：使用 **信息集蒙特卡洛树搜索（IS-MCTS）**。各根动作的第 N 次访问共享第 N 组公开剩余牌采样与对手倾向，采样随机数独立于选枝随机数。通过 UCT 选择分支、扩展一个行动，再用标准策略模拟至本纪元结算并回传收益。默认总预算为根候选数 × 32 次，UCT 自适应分配模拟次数，最终选择访问最多的行动。每个节点缓存公开信息策略建议，优先扩展建议动作，并使用随访问次数递减的探索加分；仍会探索所有根候选，模拟收益可以推翻策略建议。树集中搜索当前 AI 自己的连续决策；对手按每次采样的竞价倾向作出响应，避免有限预算下把对手未充分探索的差招当作机会。不同公开局面分别建立后续分支，相同种类与变体的牌合并。

搜索树中的拍卖出价分别建分支，树外模拟用完整拍卖枚举加速；对手的同轮拍卖续着复用到当前 AI 再次行动为止。库存统计和全桌圆盘排名在一次估值中复用，避免重复计算。默认模拟本纪元最多 240 步，后续纪元用永久牌与圆盘潜力估值。TS 与 C++ 均支持 `horizon: "next-epoch"`，实际执行纪元切换并模拟到下一纪元计分结束（最多 480 步）；`horizon: "game"` 可模拟至终局（最多 720 步），截断估值会加回已结算得分。神祇换牌会合并等价目标并保留估值最高的三个候选，灾难阶段按弃牌组合估值选择。对手模型包含不同的圆盘保留倾向。搜索报告包含访问次数、树深、节点数、未抵达目标的截断次数、行动均值与采样标准误；这些误差仅作诊断，不是自适应搜索后的置信区间。

Worker 接收公开牌、圆盘、公开弃牌和由完整牌表扣除公开牌所得的剩余牌多重集合，不接收真实袋中顺序、洗牌种子或其他玩家的实际总分。搜索还会把累计总分归一化，只比较公开局势及之后的得分。模拟复用实际规则引擎，轻量复制状态，不改写实战或存档；暂停及弹窗仍能取消 Worker。

论文算法对照选项：`variant: "sh"` 在根节点使用 Sequential Halving，`variant: "dpw"` 控制内部决策与随机结果的分支增长，默认仍为原有 `uct`。`timeMs: 200` 可设置 200 ms 软计算预算，按完整模拟检查时限；时间模式的 SH 采用 Anytime 调度。实现依据、信息隔离处理和独立验证设计见 [SH / DPW 实验设计](../artifacts/ai-tree-methods.md)。

独立对照已完成 336 局：固定预算 SH、DPW 分别获得 22/84、23/84 次第一名；200 ms 等时组分别为 27/84、25/84，等强参考均为 24/84。这轮未显示足以替换默认搜索的稳定优势，详见 [完整结果与种子区间](../artifacts/ai-tree-benchmark.md)。200 ms 是本次对照预算，当前游戏默认仍为 UCT、根候选数 × 32 次总模拟预算。

新增两项独立对照共 168 局：原 UCT 200 ms 对固定预算 UCT 获得 27/84 次第一名；自我对弈学习估值与原估值双方同为 200 ms 时获得 23/84，等强参考都是 24/84。学习模型使用 2,000 局训练、400 局开发，开发集玩家相对分差 MSE 改善约 2.9%，但未转化为稳定对局收益；当前默认设置保留。见 [预算与学习估值结果](../artifacts/ai-value-benchmark.md) 和 [完整实验协议](../artifacts/ai-value-methods.md)。学习估值已同时接入 TS 和 C++，通过 `valueModel` 选项显式启用。

可复现的强度与耗时比较：

```bash
# 同局面、同预算的 TypeScript / C++ Wasm 耗时与搜索一致性
npm run benchmark:wasm -- artifacts/ai-wasm-benchmark.json
# SH、DPW 历史实验使用已冻结的 ABI 3，防止后续引擎版本影响复现
node --experimental-strip-types scripts/benchmark-budget-control.ts --variants sh,dpw --modes fixed,time --seeds 6 --start 14001 --time-ms 200 --jobs 8 --cost-source artifacts/ai-tree-40ms-stopped.json --out artifacts/ai-tree-rerun.json
# 四组完整结束后生成报告，按整个种子区组计算不确定性
node --experimental-strip-types scripts/summarize-tree.ts
# 跨纪元搜索：6 个新种子，2–5 人全部座位，共 84 局
npm run benchmark:horizon -- --split validation --seeds 6 --jobs 3 --out artifacts/ai-next-epoch-validation.json
# 跨纪元 32 次预算，对原版 64 次预算，另 84 局
npm run benchmark:horizon -- --split validation --seeds 6 --opponent-samples 64 --jobs 3 --costs off --out artifacts/ai-next-epoch-budget-control.json
# 两组完成后，检查完整性并生成汇总报告
node --experimental-strip-types scripts/summarize-horizon.ts
# 对本次优化前的 MCTS，相同模拟预算，轮换全部座位
npm run benchmark:ai -- --seeds 1 --start 8201 --opponent mcts --out artifacts/ai-guided-mcts-vs-mcts.json
# 相同公开局面、相同模拟预算的耗时对照
npm run benchmark:search -- artifacts/ai-guided-search-cost.json
# 对最初 24 次采样、单纪元搜索，轮换全部座位
npm run benchmark:ai -- --seeds 1 --start 7401 --opponent previous --out artifacts/ai-mcts-vs-previous.json
# 对最初的规则启发式进阶 AI：2–5 人，每个牌序轮换新版 AI 所有座位
npm run benchmark:ai -- --seeds 4 --start 2001 --out artifacts/ai-vs-legacy.json
# 对新版标准策略（不同的对照策略）
npm run benchmark:ai -- --seeds 2 --start 3001 --opponent policy --out artifacts/ai-vs-policy.json
```

跨纪元搜索的独立种子与更多计算预算对照见 [跨纪元验证记录](../artifacts/ai-next-epoch-benchmark.md)。该模式保留为显式搜索选项，默认仍使用本纪元 32 次预算。

此前共享场景与策略引导的对照见 [优化验证记录](../artifacts/ai-guided-mcts-benchmark.md)。

首版 MCTS 的逐局对照与限制见 [MCTS 验证记录](../artifacts/ai-mcts-benchmark.md)。

上一版单纪元搜索的历史验证：对旧版进阶赢得 **44/56** 场，对新版标准赢得 **22/28** 场。参见 [完整验证记录](../artifacts/ai-benchmark.md)。

首版 MCTS 与其策略、估值冻结在 `tests/fixtures/previous-mcts.ts`、`previous-policy.ts`、`previous-evaluation.ts`，用于相同模拟预算的对照。更早的单纪元搜索冻结在 `tests/fixtures/previous-search.ts`，以相同的公开信息及标准后续策略作为直接对照。MCTS 仍在可终止的 Worker 中运行。最初的旧版对照策略冻结在 `tests/fixtures/legacy-ai.ts`。报告记录每局人数、种子、座位、最终排名、分差和计算耗时，按正式规则以最高太阳圆盘打破平分。机器人对战只能衡量相对提升，不能直接证明对熟练真人的胜率；尚未做真人水平标定。

## 存档与规则结构

`src/game/engine.ts` 是纯函数规则引擎，`advance` 仅接受合法行动，不改变原状态。`src/game/storage.ts` 保存版本、配置、随机种子及完整行动序列。导入逐步重放验证后才替换现有比赛；非法或损坏存档不会覆盖当前对局。回放不执行电脑行动，不改写比赛存档。未确认选牌不保存。

测试既覆盖关键边界，也让 2–5 人、三档难度完成三纪元对局，并逐步检查全部牌及太阳圆盘守恒。`scripts/simulate.ts` 提供可复现批量运行。

## Docker

```bash
docker compose up -d --build
# http://localhost:8205
# 指定端口：RA_PORT=8080 docker compose up -d --build
docker compose ps
docker compose down
```

Docker 配置已提供；本次交付未实际构建容器。

## 规则与版权

采用 [25th Century Games 基础版规则书](https://bghub.org/r/ra.pdf)，未包含 Traders 扩展。游戏设计归 Reiner Knizia；本项目为非官方练习实现，图形为项目内原创 SVG，不使用原作出版插画。

学习估值和独立预算对照（新输出文件名可避免覆盖既有结果）：

```bash
npm run train:value -- --train 2000 --dev 400 --jobs 2
npm run benchmark:budget-control -- --variants uct --modes time --opponent-fixed yes --seeds 6 --start 15001 --jobs 6 --costs off --out artifacts/ai-uct200-rerun.json
npm run benchmark:value -- --seeds 6 --start 40001 --jobs 8 --costs off --out artifacts/ai-value-rerun.json
# 汇总已保存的原始两组完整结果
npm run report:value
```

基准实验现在默认逐步保存可导入棋谱及根候选搜索报告，目录为结果文件名加 `.replays/`，支持 `--replay-dir`。原 168 局只有汇总，无法精确补回计时搜索的历史行动。已另存四局用于诊断，结论和复核范围见 [对局记录与决策复盘](../artifacts/decision-review.md)。

```sh
# 重新录制四个定向诊断案例；会产生新的计时决策，不能当作旧实验棋谱
node --experimental-strip-types scripts/record-decision-games.ts
# 对已存棋谱做启发式筛查和独立确认
node --experimental-strip-types scripts/analyze-decisions.ts
# 对选中疑点做末端估值分解，再扩大搜索型续局复核
node --experimental-strip-types scripts/explain-decision.ts
node --experimental-strip-types scripts/check-strong-continuation.ts
node --experimental-strip-types scripts/summarize-decision-review.ts
```

学习续局策略的第一轮试验已完成：冻结UCT200生成64局训练、16局开发，学习根候选访问分布；只替换模拟行动策略并保留原估值。开发集与教师行动的一致率从原启发式71.7%提高到77.2%，改善主要在抽牌/发起拍卖，竞价阶段尚未改善。双方200 ms的84局独立对照为27/84次第一名（等强参考24/84，种子块95%区间19.0%–44.0%），未证实稳定优势，默认继续用原策略。训练和验证共164局棋谱完整保存，最终验证共28,290步，均通过导入回放检查。见 [学习续局策略结果](../artifacts/ai-policy-benchmark.md) 与 [试验协议](../artifacts/ai-policy-methods.md)。

```sh
npm run collect:policy
npm run train:policy
npm run benchmark:policy -- --seeds 6 --start 71001 --jobs 8 --costs off --out artifacts/ai-policy-rerun.json
npm run report:policy
```

TS/C++接口支持 `search(state, { rolloutModel, timeMs:200 })`；模型位于 `artifacts/ai-rollout-model.json`，不传模型时继续复现原固定预算搜索。

## 按排名重新评价历史实验

主要评测文件保留了1,010条逐局排名/分数/分差记录（含70条先导或中止记录）；其中九组完整近期验证共756局。早期逐局统计不是逐步棋谱，只有较新的实验具备完整行动回放。统一重算见 [历史排名分析](../artifacts/ai-ranking-benchmark.md) 和 [机器可读排名汇总](../artifacts/ai-ranking-summary.json)。

按用户指定，今后优先看分人数平均名次及归一化排名得分，第一名次数/分差作为辅助指标。排名得分为 `(人数-名次)/(人数-1)`，首名100%、末名0%、等强50%；不同人数先分别求均值再等权汇总，另列对局加权口径。未来基准摘要同时保存每名次数量及等强平均名次。

重新分析后，Anytime SH / 双方200 ms的排名得分58.4%，学习续局54.1%。Anytime SH的单组种子区间50.8%–66.4%，九组比较校正后49.4%–69.8%；这是值得独立复测的排名信号，不能由此前首名指标未证实优势就否定，也不能当作已证实整体更强。各组对手和预算不同，不视为互相交手的统一排行榜。本次仅重算历史数据，默认算法不变。

```sh
npm run report:rankings
```

## Anytime SH 新种子复测与排名奖励

当前实验为两组各280局：SH vs UCT / 双方200ms；SH后续排名奖励 vs SH原奖励 / 双方200ms（另一批种子）。原计划500ms组按用户要求在启动前取消，原始方案已归档。以分人数平均名次和人数等权归一化排名分为主指标，以种子区组计算置信区间，保留完整棋谱和构建哈希。协议见 [独立复测方案](../artifacts/ai-sh-confirmation-methods.md)。

```sh
npm run benchmark:sh-study -- --jobs 8
# 相同源码/二进制重复执行会从完整对局检查点续跑
npm run report:sh-study
```

TS/C++支持实验选项 `search(state, { variant: "sh", reward: "future-rank", timeMs: 200 })`。排名奖励只比较模拟新增得分和原未来估值的相对顺序，不使用真实隐藏累计分数，不能解释为最终名次的精确概率。默认继续采用UCT / 原奖励；200ms原版对照使用冻结ABI5，排名奖励支持于ABI6。

本轮按用户要求停止：SH200已完成280局，排名得分51.1%（种子95%区间46.7%–55.3%），未确认优势；排名奖励完成120局后中止，500ms未运行。共保留400局完整棋谱。当前应查看 [停止报告](../artifacts/ai-sh-study-report.md)，不将部分奖励组视为完整验证。
