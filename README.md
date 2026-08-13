# dsh-plugin-publisher

DeepSeek Harness（DSH）插件开发与 GitHub 发布工作流技能插件。

安装并**开启授权（consent）**后，插件会把内置的 **`dsh-plugin-publishing`** 技能注册到会话：AI 可据此独立完成「把技能打包成 DSH 插件 → 本地验证 → 发布到 GitHub（含 `dsh-plugin` topic）→ 进入插件市场」的完整流程。

> ⚠️ **授权门禁（Consent Gate）**：本技能驱动的操作会**创建公开 GitHub 仓库并推送代码**，因此插件默认**不注册任何技能**。只有你在配置中显式设置 `config.consent: true` 并重启 DSH 后才会生效。见下方「开启授权」。

## 技能内容

- **铁律**：用户授权门禁、隐私红线（token/凭据/本地路径/个人信息绝不入仓）、免责声明、超时不死等
- **环境确认**：node / pnpm / git / dsh CLI / GitHub 凭据检测（不回显 token）
- **DSH 插件契约速查**：bundle / profile / patch 层 / host-only / 运行时技能注册 / 零依赖策略 / consent 模式
- **开发步骤**：标准目录结构、package.json、cordis.patch.yml、lib/index.js、SKILL.md、.gitattributes
- **验证矩阵**：node --check + mock 单测 + scratch 组合测试（⚠️ 不能跑任务）+ headless 运行时测试（consent off/on）
- **GitHub 发布**：隐私扫描 → 建仓 → 打 topics（`dsh-plugin` 必打）→ 推送 → 匿名/克隆验证
- **市场可见性**：registry 每 2 小时重建、搜索索引延迟、市场接口验证
- **FAQ / 超时处理**、授权与安全、免责声明

## 安装

### 方式一：DSH 插件市场（推荐）

1. 打开 DSH Web GUI → **设置 → DSH插件市场**
2. 搜索 `dsh-plugin-publisher`，点击 **安装**
3. 重启 DSH（`dsh web`）

### 方式二：命令行

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:<owner>/dsh-plugin-publisher
```

## 开启授权（必须，否则插件不工作）

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，在 `dsh-plugin-publisher` 行下加 `config`（整段替换，只有这一个键，直接写即可）：

```yaml
- insert:
    - id: dsh-plugin-publisher
      name: dsh-plugin-publisher
      config:
        consent: true
```

保存后**重启 DSH**。之后会话中会出现可用技能 `dsh-plugin-publishing`；用它时 AI 仍会先征得你对每次发布操作的明确同意。

也可以临时开启（不落盘）：`dsh --patch "dsh-plugin-publisher: { consent: true }"`。

## 验证

```sh
pnpm verify
```

检查：插件语法、SKILL.md 完整性、运行时注册行为、**consent 门禁**（false 不注册 / true 注册）。

## 免责声明

- 本插件及内置技能仅提供开发与发布流程的**操作指引**；所有写操作（创建公开仓库、推送代码、修改 topics）**必须由用户明确授权后**才会执行。
- **公开发布不可撤回**：代码、描述一旦推送到公开仓库即对外可见，请自行评估并提前做隐私扫描；发布后 GitHub 历史中的任何泄露信息都可能被复制。
- 第三方插件市场（如 dsh-plugin-marketplace）仅提供发现与安装便利，与 DeepSeek Harness、本插件及其作者无任何关联，不对任何插件的质量、安全性作担保。
- 本插件按「现状」（AS-IS）提供，不收集、不上传任何用户数据；因使用本插件或其引导的发布/安装行为造成的任何损失由使用者自行承担。
- 安装插件即信任该仓库（插件市场可能执行仓库内的安装脚本或 npm 生命周期脚本），请只安装你已审查的仓库。

## 文件结构

```
dsh-plugin-publisher/
├── package.json          # cordis 插件清单（零依赖，dsh.bundle.patch）
├── cordis.patch.yml      # 配置层（consent: false 默认）
├── lib/index.js          # Host 插件：consent 门禁 + 运行时技能注册
├── .dsh/skills/dsh-plugin-publishing/SKILL.md   # 工作流技能本体
├── scripts/verify.mjs    # 验证脚本
└── README.md / LICENSE
```

## 许可

MIT © 2026 dsh-plugin-publisher contributors
