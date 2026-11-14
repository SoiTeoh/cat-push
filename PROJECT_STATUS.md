# Cat Push（小猫：鬼点子生成中）— 项目状态

## 1. 项目定位

`cat-push` 是 Idea Lab v2 的 Project 01：一款基于 **Vite + TypeScript + Matter.js + HTML5 Canvas 2D** 的竖屏物理恶作剧小游戏。  
玩家控制小猫在铲屎官回头前把桌面物品推至悬边或推落地面，并在回头瞬间松手装睡，支持「闯关捣蛋（4 大主题房间）」与「无尽茶水间」双模式。

## 2. 当前开发阶段

- **V1.0 第一阶段（Step 1：手感精修 + 4 主题关卡 + 物理道具扩充）已完成本地开发与全量自动化验收**。
- **暂未推送远程**：等待用户本地实机试玩这 4 个新房间与新机制后再决定微调或提交推送。

## 3. 已实现功能（V1.0 Step 1）

- **4 项原型实测瑕疵修复**：
  1. **防穿模接触停靠**：向右推物时猫身停靠在物体左边缘外侧（`bodyHalfW` 边界约束），仅伸出前爪抵住左侧面带扒拉微动画推进。
  2. **重物重量拉开差距**：大幅提高 `kettle`、`keyboard`、`mirror`、`fishbowl` 等 Boss 重物的密度与静摩擦，需配合「轻拍!」或分心窗口耐心啃推。
  3. **悬边异常引发额外怀疑**：第 2 关及无尽第 2 桌起，若 `WATCHING` 期间桌面存在 `teeter >= ×2.0` 悬边物品，主人盯防延长 `+0.6s`（头顶提示 `嗯？杯子怎么歪了…`）并缩短下次 `RELAXED` 安全期。
  4. **移动端触屏「轻拍!」按钮**：画布右下角新增独立悬浮圆钮 **`轻拍! (Space)`**（带冷却弧），与左/右半区移动多指隔离。
- **双模式 + 4 大主题房间 + 15 种物理道具**：
  - `src/config/stages.ts` & `src/config/tuning.ts`：定义「闯关捣蛋（4 关解锁 + 1–3 星本地存档）」与「无尽茶水间（第 2 桌起随机打乱站位与间距）」。
  - **Stage 1 早茶厨房台**（¥300）：`tissue`、`pen`、`mug`、`kettle`。
  - **Stage 2 打工人书房桌**（¥550）：`mouse`（极滑）、`ink`（黑墨溅射高噪声）、`phone`（周期震动自滑背刺）、`keyboard`（重型障碍）。
  - **Stage 3 精致化妆台**（¥800）：`lipstick`（神经质乱滚）、`compact`（粉雾）、`perfume`（高重心易碎，桌上提前倾倒仅半价折损）、`mirror`（重物 Boss）。
  - **Stage 4 客厅茶几终极战**（¥1100）：`remote`、`wineglass`（高脚易倒）、`fishbowl`（¥500 终极金鱼缸 Boss，摔落水花四溅 + 小金鱼逃生动画）。
- **主人分心彩蛋窗口**：`RELAXED` 期间每 `14–18s` 触发 `📱 回消息中`（持续 `2.6s`），期间屏蔽 `WARNING`，提供偷推重物的黄金窗口。

## 4. 最新测试与构建结果

- `npm.cmd --prefix D:\Codex\idea-lab\cat-push run typecheck`：通过（0 错误）。
- `npm.cmd --prefix D:\Codex\idea-lab\cat-push test`：1 个测试文件、**27 项** Vitest 单元测试全部通过（`tests/rules.test.ts`）。
- `npm.cmd --prefix D:\Codex\idea-lab\cat-push run build`：通过（`dist/index.html` `0.60 kB`、`dist/assets/index-BifpYGoy.css` `0.44 kB`、`dist/assets/index-DImoz4Yu.js` `127.93 kB` / gzip `41.64 kB`）。
- Playwright Chromium 三视口端到端验证（`360×640`、`390×844` 含 `?debug=1`、`1280×800`）：
  - 均满足 `fitsViewport: true`、`overflow: false`、0 控制台错误、0 页面异常、0 外部网络请求。
  - 已验证标题双模式切换、选关卡片、右推停靠电水壶外侧不穿模、点击右下角「轻拍!」按钮与冷却弧渲染正常。

## 5. Git 状态

- 独立 Git 仓库（`D:\Codex\idea-lab\cat-push`，基于 `cd2bf1a`），V1.0 Step 1 改动暂保留在本地工作区，待实机试玩确认后再 commit & push。
