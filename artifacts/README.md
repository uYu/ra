# 实验资料索引

本目录的报告、实验方案、小型原始统计、测试模型与冻结基线进入仓库；完整棋谱、教师对局、训练数据集和大体积筛查数据只保留在本地，不提交。最新结论以 [当前进展](../PROGRESS.md) 为准，避免将历史正向信号当作已经确认的提升。运行日志在本地保留但不纳入 Git。

## 最近一轮：已停止

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

`.gitignore` 排除 `*.replays/`、`policy-teacher/`、`decision-replays/`、`*-dataset.json`、`decision-screen.json`、运行日志与停止前备份。目录中的索引或逐局统计可能引用这些仅在本地存在的路径；这是数据保留策略，不意味着仓库包含完整原始对局。

普通安装、构建和测试只依赖已提交的小模型与冻结基线。`report:value`、`report:policy`、决策复盘及完整SH研究汇总等命令需要对应本地数据；它们不能仅凭源码克隆还原此前计时搜索的历史轨迹。
