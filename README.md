# RA · 太阳神

Ra 基础版的非官方中文网页实现。支持 2–5 人、真人与电脑混合对局、三纪元完整计分、自动存档和行动回放，无需账号、后端或模型 API。

## 本地运行

需要 Node.js 22.13+。

```bash
npm ci
npm run dev -- --port 5174
```

打开 <http://127.0.0.1:5174>。

```bash
npm run build                  # 校验 Wasm、TypeScript 检查和生产构建
npm run preview -- --port 5174
npm test                       # 完整规则、AI、回放和 Worker 回归
npm run simulate -- 10 hard    # 显式运行 10 场进阶 AI 对局
```

`dist/` 可部署到静态 HTTP 服务器，支持子目录路径。普通构建使用仓库内的 Wasm，不需要 C++ 工具链；修改 C++ 后需安装 Emscripten，再运行 `npm run build:wasm`。

## 功能

- 180 块基础版牌，完整拍卖、神祇交换、灾难处理、太阳圆盘交换和三纪元结算。
- 2–5 人、全真人或混合电脑，入门/标准/进阶三档 AI。
- 中文玩家板、规则与计分说明、动作播报、牌桌动画、暂停及减少动态效果支持。
- 自动存档、JSON 导入导出、逐步回放、速度和音效设置。
- 桌面和手机布局，本地 SVG 图形，无外部图片或字体请求。

累计分默认隐藏；单人模式显示自己的分数，终局公开全部分数。界面可查看其他分数便于教学，AI 不读取对手真实隐藏总分或真实牌袋顺序。当前没有联网房间。

## AI 当前状态

进阶 AI 在 Web Worker 内使用 **C++ / WebAssembly 信息集 MCTS**，默认 **UCT、本纪元搜索、根候选数 × 32 次模拟、原相对分差奖励**。Wasm 加载失败时回退到 TypeScript 参考实现。ABI 当前为 **6**，源码与二进制通过 SHA-256 校验。

SH、DPW、延长搜索时域、时间预算、学习估值、学习续局和后续排名奖励均保留为显式实验选项，没有因试验结果自动启用。

最近的 Anytime SH 200ms 新种子复测完成 280 局，人数等权排名得分 **51.1%**，种子区组 95% 区间 **46.7%–55.3%**，未确认优于等强参考 50%。排名奖励组完成 120/280 局后按用户要求停止；500ms 组未启动。最新一轮在本地保留 400 局完整棋谱，实验当前已停止；这些生成对局不进入 Git。

详细结论、验证记录和待办见 [当前进展](PROGRESS.md)。

## 代码结构

| 路径 | 职责 |
|---|---|
| `src/App.tsx`、`src/components/` | 对局界面、玩家板、规则说明和交互 |
| `src/game/engine.ts`、`data.ts`、`types.ts` | TS 规则、牌组、计分和状态模型 |
| `src/game/storage.ts`、`presentation.ts`、`motion.ts` | 存档回放、动作展示和动画 |
| `src/game/ai/`、`src/game/ai.worker.ts` | TS 搜索参考、Wasm 桥接和 Worker 回退 |
| `native/` | C++ 规则/搜索核心、构建清单和 [原生说明](native/README.md) |
| `scripts/` | 构建、对战、训练、复盘和报告工具 |
| `tests/` | 规则与跨语言一致性测试、历史 AI 基线 |
| `artifacts/` | [实验索引](artifacts/README.md)、原始统计、棋谱、模型与源码快照 |

仓库保留实验报告、小型逐局统计、模型和冻结基线；完整棋谱、教师对局、训练数据集、详细筛查数据、依赖、前端构建目录与日志由 `.gitignore` 排除并保留本地。部分研究汇总命令需要这些本地原始数据，单独克隆仓库后不能直接重建全部历史报告。历史复现命令与详细界面开发记录见 [开发历史归档](docs/DEVELOPMENT_HISTORY.md)。

## Docker

```bash
docker compose up -d --build
# http://localhost:8205
# 指定端口：RA_PORT=8080 docker compose up -d --build
docker compose down
```

Docker 配置已提供，当前未重新验证容器构建。

## 规则与版权

采用 [25th Century Games 基础版规则书](https://bghub.org/r/ra.pdf)，未包含 Traders 扩展。游戏设计归 Reiner Knizia。本项目为非官方练习实现，图形为本地原创 SVG，未使用出版版插画；版图设计参考 [Ian O’Toole 的官方展示](https://www.ianotoole.com/work/ra)。
