# Cat Push（小猫：鬼点子生成中）— 项目状态

## 1. 项目定位

`cat-push` 是 Idea Lab v2 的 Project 01：一款基于 **Vite + TypeScript + Matter.js + HTML5 Canvas 2D** 的竖屏物理恶作剧小游戏。  
玩家控制小猫在铲屎官回头前把桌面物品推至悬边或推落地面，并在回头瞬间松手装睡，在 60 秒内刷出更高破坏账单。

## 2. 当前开发阶段

- **MVP 核心开发与自动化验证已完成**（Task 1～5 对应工程搭建、Matter.js 物理桌面、纯逻辑状态机与悬边倍率、Canvas 2D 矢量与音效表现、`?debug=1` 调试视图、单元测试与三视口 Playwright 自动化检查）。
- **已进入 v1 封存归档阶段**：完成本地首提交并同步至 GitHub 仓库 `SoiTeoh/cat-push`；真机/人工试玩后的深化打磨项已记录至 `Future Polish / v2 Backlog`。

## 3. 已实现功能

- `src/config/tuning.ts`：集中管理视口（`390×640`）、固定物理步长（`1000/60 ms`）、小猫移动/轻拍参数、悬边倍率阈值（`6°` / `1.5s`）、铲屎官状态机节奏及 4 种物品物理参数。
- `src/game/rules.ts`：纯 TypeScript 核心规则（`evaluateTeeterState`、`computeRelaxedInterval`、`stepSteward`、`createBillSummary`、`recordItemDrop`）。
- `src/game/world.ts`：Matter.js 刚体世界，包含桌面/桌沿/地板传感器、4 种不同材质物品（`tissue`、`pen`、`mug`、`kettle`）、推物与 `Space` 轻拍脉冲、波次自动补货。
- `src/game/audio.ts`：Web Audio API 合成音效（警告提示音、轻拍、碎裂、抓包）及右上角静音开关。
- `src/render/painter.ts`：Canvas 2D 矢量画面渲染（3 种瞳孔表情与 `0.12s` 装睡压扁过渡、物品拟人表情与悬边汗珠、HUD、开局与账单结算卡片、`?debug=1` 调试叠层）。
- `src/main.ts`：DPR 自适应缩放、固定步长主循环、触屏/鼠标左右半区按住与键盘控制、`localStorage` 最高分持久化（带 `try/catch` 降级保护）。

## 4. 尚未实现 / 暂缓事项

- 真机触屏与桌面端人工手感试玩后的参数微调（见下方 `Future Polish / v2 Backlog`）。

## 5. 最新测试与构建结果

- `npm.cmd --prefix D:\Codex\idea-lab\cat-push run typecheck`：通过（0 错误）。
- `npm.cmd --prefix D:\Codex\idea-lab\cat-push test`：1 个测试文件、16 项 Vitest 单元测试全部通过（`tests/rules.test.ts`）。
- `npm.cmd --prefix D:\Codex\idea-lab\cat-push run build`：通过（`dist/index.html`、`dist/assets/*` 打包成功）。
- Playwright Chromium 三视口端到端验证（`360×640`、`390×844` 含 `?debug=1`、`1280×800`）：
  - 画布均完整适配视口，无横向/纵向溢出（`overflow: false`、`fitsViewport: true`）。
  - 开局点击、右推、松手装睡、`Space` 轻拍、左移全程 0 控制台错误、0 页面异常、0 外部网络请求。

## 6. Git 状态

- 独立 Git 仓库（`D:\Codex\idea-lab\cat-push`，`main` 分支），已配置远程 `origin` 为 `https://github.com/SoiTeoh/cat-push.git`，并创建 v1 MVP 封存首提交。

## 7. Future Polish / v2 Backlog

以下 4 项为初版录屏实测观察到的打磨方向，暂不在 MVP 阶段修改，留待后续正式版 / v2 迭代：

1. **视觉穿模小瑕疵（录屏 00:13、00:56）**：小猫向右推电水壶时，猫身子会直接重叠画在电水壶前面，看起来像钻进了水壶里，而不是用爪子抵着水壶左侧边推。后续需优化绘制层级与接触偏移，让小猫前爪紧贴物体外侧推进。
2. **波次排版固定（录屏 00:00、00:23、00:40）**：每桌刷出的物品固定为从左到右“水壶 → 马克杯 → 笔 → 纸巾”，到第 3 桌时新鲜感会下降。后续可从第 2 桌起随机打乱物品站位（例如把易滚的圆珠笔放在水壶左侧），迫使玩家先绕行或更小心地控制连锁碰撞。
3. **电水壶目前太轻（录屏 00:55–00:58）**：当前只需约 3 秒即可把大电水壶推下桌轻松拿走 ¥300，缺少“拼命推 Boss 重物”的吃力感。后续需调高电水壶质量/摩擦或分段阻力，强化重物博弈节奏。
4. **“悬边物品”被主人看到的处理（录屏 00:46）**：当前即使杯子已歪在桌沿 `×3.0` 摇摇晃晃，只要猫不动，主人就会假装没看见。后续可在高难度波次中加入“桌沿有物品倾斜悬停时，主人回头盯视时间更长，甚至会走近或缩短下次 `?` 预警时间”，自然拉升后期紧张感。
