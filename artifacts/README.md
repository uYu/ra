# 实验资料索引

本目录的报告、实验方案、小型原始统计、测试模型与冻结基线进入仓库；完整棋谱、教师对局、训练数据集和大体积筛查数据只保留在本地，不提交。最新结论以 [当前进展](../PROGRESS.md) 为准，避免将历史正向信号当作已经确认的提升。运行日志在本地保留但不纳入 Git。

## 2026-10-28 当前交接

| 资料 | 状态与结论 |
|---|---|
| [预算对照](ai-uct2s-control-summary.json) | 84/84完成；人数等权55.8%，95%区间48.7%–63.3%，未确认稳定优势 |
| [原始/当前同局面性能](ai-perf-original-vs-current-20261028.json) | 2秒平均模拟9483→29756，约3.14倍；固定预算报告一致 |
| [性能版对原版](ai-version-2s-control.json) | 用户停止54/84；[停止记录](ai-version-2s-stop-record.json) |
| [对手入树100ms](ai-opponent-100ms-50-summary.json) | 50/50完成；32.9%，95%区间22.0%–43.6% |
| [对手入树2秒](ai-opponent-2s-50.json) | 用户停止32/50；[停止记录](ai-opponent-2s-stop-record.json) |
| [双方入树、跨纪元对本纪元](ai-cross-epoch-2s-50.json) | 仅2–4人，用户停止36/50；[停止记录](ai-cross-epoch-2s-stop-record.json) |
| [真实出价局面诊断](ai-bid-search-diagnosis-20261028.json) | 定制裁剪已撤回，尚无验证过的通用修复 |
| [Ra论文方向局面消融](ai-ra-literature-study-20261028/summary.json)、[整体核验汇总](ai-ra-literature-study-20261028/match-verified.json) | 56局200ms完成：慢扩宽46.7%、加0额外续局30.0%；仅两个独立种子，不切换默认，不按第255步选参数 |
| [配对采样实现与等预算比较](ai-paired-sampling-20261028/summary.json) | 显式实验，浏览器默认保持原采样；同局面2秒旧3次选4、新3次选1，未确认总体棋力 |
| [探索/预算续查](ai-search-exploration-20261028/summary.json)、[长预算](ai-search-exploration-long-20261028/summary.json) | 原设置32768次选4、131072次选1；线性奖励也随预算反复；降低树内探索为机制消融 |
| [冻结策略独立评价](ai-search-frozen-policy-20261028/summary.json) | 原树冻结后，4096个独立场景在原tanh目标下由1胜出；支持探索续着影响根估计，未证明通用修复 |
| [独立终局检查](ai-search-exploration-20261028/oracle-checks.json) | 20个已有小终局、46个根行动两套转移对照；三种探索设置均全对，集合区分力不足 |

计划与 `*-source-snapshot/` 一起保留，核验计划哈希和冻结文件，不能要求后续工作区与历史快照相同。各实验原始数据指向的 `.replays/` 在本地；中断实验不生成完整样本的最终区间，不追加样本拼成确认性结论。所有完成监控已删除，既有看板与游戏进程不因本次提交而关闭。

`ai-bid-search-audit-20261028/` 保存配对续局、轨迹及48条独立TS交叉检查；`ai-bid-search-structure-20261028/` 保存收益/树深/算法消融。`ai-last-bid-fix-qa.json` 是已撤回裁剪的历史记录，不代表生产修复完成。公开局面夹具在 `tests/fixtures/last-bid-final-epoch.json`；完整玩家存档与真实牌袋状态不提交。

## 历史 SH 复测：已停止

- [停止报告](ai-sh-study-report.md)：SH200 完成 280 局，排名奖励 120 局后中止，500ms 未运行；共 400 局完整棋谱。
- [停止汇总](ai-sh-study-stopped-summary.json)、[SH 完整统计](ai-sh-sh200-summary.json)、[方案](ai-sh-confirmation-methods.md)、[运行清单](ai-sh-study-manifest.json)、[QA](ai-sh-study-qa.json)。
- `ai-sh-sh200.json`、`ai-sh-rank200.json`：逐局结果；各自 `.replays/` 目录保存完整行动与搜索报告。
- `ai-sh-study-initial-plan/`：取消 500ms 前的原始方案与脚本。
- `ai-sh-study-source-snapshot/`：哈希校验的源码和 Wasm 快照；`index.json` 保存来源和 SHA-256。

`ai-sh-rank200.json` 状态为 `stopped-user`；不得将其写成完整 280 局实验。`ai-sh-rank200.json.before-user-stop` 在本地保留停止标记写入前的原始检查点，也不提交。

## 历史实验

| 报告 | 原始数据/资料 |
|---|---|
| [历史排名重算](ai-ranking-benchmark.md) | `ai-ranking-summary.json`，报告列出原始文件与哈希 |
| [SH / DPW](ai-tree-benchmark.md) | `ai-tree-validation.json`、`ai-tree-methods.md` |
| [跨纪元搜索](ai-next-epoch-benchmark.md) | `ai-next-epoch-validation.json`、`ai-next-epoch-budget-control.json` |
| [学习估值与预算对照](ai-value-benchmark.md) | `ai-value-*`、`ai-uct200-control.json` |
| [学习续局](ai-policy-benchmark.md) | `ai-policy-*`、`ai-rollout-model.json`、`policy-teacher/` |
| [决策复盘](decision-review.md) | `decision-*.json`、`decision-replays/` |
| [Wasm 性能](ai-wasm-benchmark.md) | `ai-wasm-benchmark.json` |

模型和训练数据保留用于研究追溯，不会自动加载为默认 AI。各 `*.replays/`、`policy-teacher/` 和 `decision-replays/` 中的对局可通过应用 JSON 导入回放。早期只有逐局统计的实验不具备历史逐步棋谱。

## 冻结基线与界面记录

- `frozen-uct3/`、`frozen-uct4/`、`frozen-uct5/`：原生源码、Wasm 及构建清单；对应桥接位于 `src/game/ai/wasm-frozen-uct*.ts`。
- `ra-*.png`、`ra-*.jpg`：历史界面检查图，当前界面以代码为准。

使用新种子和新输出文件开展后续验证；不要覆盖原记录后宣称独立复测。存档中的 `replayPath` 从仓库根目录解析，命令也应从仓库根目录运行。

## Git 排除范围

`.gitignore` 排除 `*.replays/`、`policy-teacher/`、`decision-replays/`、`*-dataset.json`、`decision-screen.json`、运行日志、PID、原始CPU剖析、未脱敏玩家存档、可再生成的原型TS参考副本与停止前备份。目录中的索引或逐局统计可能引用这些仅在本地存在的路径；这是数据保留策略，不意味着仓库包含完整原始对局。

普通安装、构建和测试只依赖已提交的小模型与冻结基线。`report:value`、`report:policy`、决策复盘及完整SH研究汇总等命令需要对应本地数据；它们不能仅凭源码克隆还原此前计时搜索的历史轨迹。

## MCCFR 独立原型（2026-10-29）

`ai-ra-cfr-20261029/`保留冻结计划/源码、Kuhn验证、12次缩小版Ra训练、42000对评估与汇总核验。小游戏最多两轮拍卖、公开加法计分，不是正式Ra，不与生产UCT直接比较。双人可被针对程度下降，三至五人暂未胜过贪心策略；未改线上AI或学习模型。复现：`node --expose-gc --experimental-strip-types scripts/study-ra-cfr.ts <新输出目录>`；核验：`node --experimental-strip-types scripts/check-ra-cfr-study.ts <输出目录>`。

## 拍卖穷举＋抽样续局（2026-10-29）

`ai-auction-sampling-20261029/`为正式Ra独立原型：仅当前拍卖的静态叶子估值改为共同场景续局均值，完整倒推各出价者自己的relative/tanh收益；其他阶段仍用原UCT。28局、双方200ms、2–5人全部座位、两新种子，人数等权排名分56.25%，正向信号集中于三人；小样本且不是线上2秒棋力结论。`summary.json`、`qa.json`、`match-verified.json`和冻结源文件保留，9191步完整棋谱回放通过；原型未发布。完整棋谱在被排除的`match.replays/`。复现依次运行`build-auction-sampling-study.ts`、`check-auction-sampling.ts`、`benchmark-auction-sampling-match.ts`、`check-auction-sampling-match.ts`，均传入新的输出目录；执行方式为`node --experimental-strip-types scripts/<脚本名> <目录>`，构建原型需要现有Emscripten环境。

2026-10-30：`ai-auction-2s-20261029/`正式对照在85/168局因严格耗时检查中断；已复现冻结原UCT在1000000次模拟硬上限提前返回，见`timing-cap-reproduction.json`。附加`timing-cap-resume.json`记录仅修正运行/验收检查的文件哈希；原计划、算法、二进制、参数和85局结果保持不变，六路续跑余下83局。最终验收将逐项列出耗时不足但确实跑满硬上限的原UCT决策，不将其宣称为用满2秒。监控仍为http://127.0.0.1:8792/。


2026-10-30最终结果：`ai-auction-2s-20261029/match-verified.json` 已完成168局/56430步，整体排名分61.5972%，种子区组95%区间56.9444%–66.7361%，支持整体提升；生产未改。

`ai-auction-turn-cached-20261030/` 为后续拍卖时机原型：Turn根UCT每外层模拟的首个拍卖采用8轮独立共同场景估值与自身收益倒推，后续拍卖不变，公开局面计划在同一次搜索内缓存。`ai-auction-turn-20261030/` 保留未缓存诊断版本；固定预算完整报告与缓存版一致。QA及4局/922步冒烟通过。正式独立12种子/168局双方2秒对照的对手是昨天已验证拍卖版，不再以原UCT为主对手。查看run-status.json和match-results.json；只有match-verified.json才表示最终验收，运行中不报棋力结论。复现：build-auction-turn-study.ts（新目录）、check-auction-turn-study.ts、benchmark-auction-turn-match.ts、check-auction-turn-match.ts；监督运行入口run-auction-turn-study.py。
