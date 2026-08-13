# dsh-plugin-publisher

DeepSeek Harness（DSH）插件开发与 GitHub 发布工作流插件（双端：Host + 设置页 GUI）。

安装后插件会把内置的 **`dsh-plugin-publishing`** 技能注册到会话（**默认启用**）：AI 可据此独立完成「把技能打包成 DSH 插件 → 本地验证 → 发布到 GitHub」的完整流程。

> ⚠️ **启用状态（opt-out）**：技能**默认启用**，保存后刷新仍保持启用；只有你在 DSH 设置页（**设置 → 插件配置 → dsh-plugin-publisher**）主动取消勾选「启用技能」并保存后才会停用。「默认启用」不等于「自动发布」——每次创建公开仓库/推送代码前，AI 仍会先征得你的明确同意。可在同一卡片（可选）填入自己的 GitHub PAT。

## 技能内容

- **铁律**：用户授权门禁、隐私红线（token/凭据/本地路径/个人信息绝不入仓）、免责声明、超时不死等
- **环境确认**：node / pnpm / git / dsh CLI / GitHub 凭据检测（不回显 token）
- **DSH 插件契约速查**：bundle / profile / patch 层（insert vs 覆盖）/ host+client 双端 / 运行时技能注册 / 零依赖策略 / 设置区 schema 免依赖写法 / 凭据联动
- **开发步骤**：标准目录结构、package.json、cordis.patch.yml、lib/index.js、lib/client.js、SKILL.md、.gitattributes
- **验证矩阵**：node --check + mock 单测（含门禁/设置/凭据监听）+ scratch 组合测试（⚠️ 不能跑任务）+ headless 运行时测试（off/on）
- **GitHub 发布**：隐私扫描 → 建仓 → 打标签（可选）→ 推送 → 匿名/克隆验证
- **分发与启用**：官方 `dsh plugin` 安装 + 设置页图形化启用；不依赖任何第三方插件市场
- **FAQ / 超时处理**、授权与安全、免责声明

## 安装（官方路径）

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:akira399/dsh-plugin-publisher
```

安装完成后**重启 DSH**（重新运行 `dsh web`）。


## 启用状态与配置（图形化）

重启后打开 DSH Web GUI → **设置 → 插件配置 → dsh-plugin-publisher** 卡片：

1. **启用技能**：**默认勾选（启用）**，保存后刷新保持启用；要停用请取消勾选 → 点「保存」，技能即注销。
2. **GitHub PAT（可选）**：在「GitHub PAT」输入框粘贴你的 **Fine-grained Personal Access Token（PAT）** → 点「保存」。插件会自动把它同步到**系统 Git 凭据管理器**，之后 `git push`/`git clone` 直接可用；内容**永不回显**，只写入 DSH 凭据存储与系统凭据管理器。

效果即时生效；可用性说明：

- 技能启用时，会话技能目录中即出现 `dsh-plugin-publishing`；用它时 AI 仍会先征得你对每次发布操作的明确同意。
- 若未填 PAT，技能照常可用——AI 会优先使用系统已有的 Git 凭据，没有则向你询问。

### 如何创建 GitHub PAT（Fine-grained Personal Access Token）

1. 打开 GitHub → 右上角头像 → **Settings**
2. 左侧最底部 **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
3. 点 **Generate new token**，填写名称（如 `dsh-publish`）与有效期
4. **Repository access** 选择 **All repositories**（因为需要创建新仓库，无法预先指定一个不存在的仓库）
5. 在 **Permissions → Repository permissions** 中授予：

| 权限 | 访问级别 | 用途 |
| --- | --- | --- |
| Contents | Read and write | 推送代码（git push / HTTPS） |
| Administration | Read and write | 通过 API 创建/删除仓库、设置 Topics |
| Metadata | Read | 自动包含（必选，保持开启） |

6. 点 **Generate token**，复制（**只显示一次**）后粘贴到设置卡片的输入框

> Fine-grained PAT 形如 `github_pat` 开头（后接下划线与一长串随机字符），与旧的 classic PAT（`ghp` 开头）不同。本插件只把它写入系统 Git 凭据管理器用于推送，不会回显或上传。

### 配置兜底（无 GUI 环境，如 headless）

默认即启用，无需任何配置。要停用，在 profile 的 `cordis.patch.yml` 加**直接覆盖条目**（勿用 `- insert:`，同 id 会启动失败）：

```yaml
- id: dsh-plugin-publisher
  name: dsh-plugin-publisher
  config:
    consent: false
```

或写入设置文档 `~/.dsh/settings.yaml`：

```yaml
dsh-plugin-publisher:
  enabled: false
```

## 验证

```sh
pnpm verify
```

检查：host/client 语法、SKILL.md 完整性、启用状态（默认启用 / 显式停用注销）、settings 区注册与变更联动、凭据监听、客户端 bundle 契约、隐私扫描。

## 免责声明

- 本插件及内置技能仅提供开发与发布流程的**操作指引**；所有写操作（创建公开仓库、推送代码、修改 topics）**必须由用户明确授权后**才会执行。
- **公开发布不可撤回**：代码、描述一旦推送到公开仓库即对外可见，请自行评估并提前做隐私扫描；发布后 GitHub 历史中的任何泄露信息都可能被复制。
- 本插件按「现状」（AS-IS）提供，不收集、不上传任何用户数据；GitHub PAT 只写入 DSH 凭据存储与系统 Git 凭据管理器，插件不记录、不回显。因使用本插件或其引导的发布行为造成的任何损失由使用者自行承担。
- 安装插件即信任该仓库（安装过程可能执行包内的 npm/pnpm 生命周期脚本），请只安装你已审查的仓库。

## 文件结构

```
dsh-plugin-publisher/
├── package.json          # cordis 插件清单（零依赖，dsh.bundle.patch + dsh.client）
├── cordis.patch.yml      # 配置层（consent: false 默认，作设置 base 兜底）
├── lib/index.js          # Host：consent 门禁 + settings 区 + 凭据→Git 凭据管理器 + 技能注册
├── lib/client.js         # Client：设置页卡片（启用开关 + GitHub PAT 输入，write-only）
├── .dsh/skills/dsh-plugin-publishing/SKILL.md   # 工作流技能本体
├── scripts/verify.mjs    # 验证脚本
└── README.md / LICENSE
```

## 许可

MIT © 2026 dsh-plugin-publisher contributors
