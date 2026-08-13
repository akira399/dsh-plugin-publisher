---
name: dsh-plugin-publishing
description: DeepSeek Harness (DSH) 插件开发与 GitHub 发布完整工作流技能。用于把技能/功能打包成 DSH 插件（cordis 插件、零依赖、consent 授权门禁、可选设置页 GUI 卡片），本地验证，发布到 GitHub（建公开仓库、打标签、推送），并在 DSH 设置页中通过图形化开关与 GitHub Token 输入框启用。含隐私红线、免责声明与超时处理。注意：本技能由 dsh-plugin-publisher 插件提供，只有用户在设置页显式启用后才会注册。
whenToUse: 当需要开发一个新的 DSH 插件、把已有技能打包成插件、发布插件到 GitHub，或复现"插件开发→验证→发布"全流程时。也用于指导在 DSH 设置页配置插件启用状态与 GitHub Token。
---

# DSH 插件开发与 GitHub 发布工作流

## 0. 铁律（动手前必读）

1. **用户授权门禁**：创建公开仓库、推送代码、修改 GitHub 上的任何东西，都是**写操作**。开始前必须获得用户明确同意（确认目标账号、仓库名、公开可见性）。用户未授权时只做只读调研与本地构建。本技能所在的插件也受授权门禁保护：**默认关闭**，用户必须在 DSH 设置页（设置 → 插件配置 → dsh-plugin-publisher）中显式「启用」才会注册；GitHub Token 也在同一卡片中由用户自愿填写。
2. **隐私红线（绝不违反）**：
   - 绝不把 token / 密钥 / 凭据 / 会话数据写进仓库、README、技能或任何提交。
   - 代码里的认证信息必须用占位符（如 `<owner>/<repo>`）；检测凭据时**不得回显 token**（只输出账号名与状态码）。
   - 不提交本地绝对路径（如 `<盘符>:\<路径>`、`/home/<用户>/<路径>` 这类形态）、用户名、邮箱等个人可识别信息；技能/README 用通用占位符。
   - 发布前用 `git ls-files` 与全文搜索（token 前缀、邮箱、绝对路径）做一次隐私扫描。
3. **免责声明（写入 README 与技能）**：本流程会创建公开仓库并推送代码，代码一经公开不可撤回；发布操作仅由用户明确授权后执行；本插件仅提供操作指引，不构成任何担保；因发布或安装造成的损失由使用者自行承担。
4. **超时不死等**：任何命令超过预期时限（headless 任务约 3~4 分钟、网络操作约 2 分钟）就换方案——先诊断（进程/日志/接口状态），再换方法（前台带超时重跑、改用 mock 验证、改用接口直调），不要无限等待。

## 1. 前置环境确认（先做，缺什么装什么）

```sh
node --version          # 需 >= 20
pnpm --version          # 缺则: npm install -g pnpm
git --version
npx -y @deepseek-ai/dsh --version   # dsh CLI
```

- **GitHub 认证**：Windows 优先用凭据管理器（`git config credential.helper`），Linux/macOS 用 credential store 或 SSH。检测已存凭据且**不回显 token**：
  ```sh
  # PowerShell
  "protocol=https`nhost=github.com`n`n" | git credential fill   # 只看 username/是否成功，token 不外泄
  ```
  拿到账号名后验证写权限（建仓探测，探测完立即删除）：
  ```powershell
  $tok = (<从 credential fill 取 password>); # 仅进程内使用，不打印
  Invoke-RestMethod -Uri "https://api.github.com/user" -Headers @{Authorization="Bearer $tok"}
  # 建一个 private 探测仓再删除，确认建仓权限
  ```
- 若用户已在 DSH 设置页填过 GitHub Token（`GITHUB_TOKEN` 凭据，dsh-plugin-publisher 会自动同步到系统 Git 凭据管理器），则 `git push` 直接可用，无需再向用户索要。
- 无任何可用凭据 → **停下来询问用户**提供方式（PAT / gh CLI 登录 / SSH），不自行猜测。

## 2. DSH 插件架构速查（契约）

- **Bundle**：作者分发的包，`package.json` 的 `dsh.bundle.patch` 指向配置层。
- **Profile**：用户运行的组合，`dsh.profile.bundles` 保存有序 bundle 列表；**不要手写**用户 profile manifest。
- **Patch 层**（`cordis.patch.yml`，顶层数组）：`- insert: - id: <行id>, name: <包名>, config: {...}`；`id` 是稳定行身份，后层按 id 整段替换 config。
- **insert 与覆盖是两种条目**：`- insert:` 用于**新增**行；对已存在的行改配置必须用**直接条目** `- id: <行id>, name: <包名>, config: {...}`（同 id 再 insert 会启动失败 `duplicate loader entry id`）。市场类工具追加的行在 profile 的 cordis.patch.yml 里，直接编辑该行即可；bundle 安装的行在包内，需在 profile 补直接覆盖条目。
- **生效顺序**：profile bundles → profile cordis.patch.yml → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch <文件路径>`（后者胜；`--patch` 只接受文件路径，可重复）。
- **Host-only vs 双端**：没有 Web 需求就不要写 client；需要设置页 GUI（开关/输入框）时写双端——host 注册 settings 区 + 逻辑，client 注册设置卡片（slot `settings.plugin.item`）。
- **运行时技能注册**（`ctx.skills.register`）契约：`{ name, description, whenToUse?, content, source, invocation?, resourceBase? }`；`source` 必须是非空字符串；`content` 传 frontmatter 剥离后的正文；返回 disposer，用 `ctx.effect(() => disposer, label)` 绑定生命周期。同名技能 first-wins（项目层 > 运行时层）。
- **零依赖策略**：只用 Node 内置模块 + 注入的 service，`package.json` 不写 dependencies/peerDependencies → 安装时无需解析任何第三方包。
- **consent 授权门禁（设置页驱动）**：插件注册 settings 命名空间（如 `dsh-plugin-publisher`，字段 `enabled`）；host 用 `ctx.inject(["settings"])` + `sctx.settings.register(ns, schema, { base })` 读取当前值并 `scope.watch()` 响应变更；`enabled` 为 true 才注册技能/执行逻辑，默认 false。组合配置里的 `consent` 键作为 base 层兜底（无 GUI 环境可用）。涉及公开发布的插件必须如此。
- **设置 schema 免依赖写法**：不 import schemastery，用最小可调用对象：
  ```js
  const schema = Object.assign(
    (value) => ({ enabled: Boolean(value?.enabled ?? value?.consent ?? false) }),
    { toJSON: () => ({ type: "object", dict: { enabled: { type: "boolean" } } }) }
  );
  ```
- **凭据联动**：`ctx.on("credentials/updated", ref => ...)` 监听凭据变更；`ctx.get("credentials").resolve(ref)` 取值（如 `GITHUB_TOKEN`）；可用 `git credential approve` 把它同步进系统 Git 凭据管理器（token 只在 credentials 存储与 OS 凭据管理器之间流转，永不落日志）。

## 3. 开发步骤（标准结构）

```
<repo>/                      # 仓库名：dsh-<功能>（npm 合法包名）
├── package.json             # cordis 插件清单：main/exports/files/dsh.bundle.patch；双端再加 dsh.client + exports["./client"]；零依赖
├── cordis.patch.yml         # 配置层（consent: false 默认，作为设置 base 兜底）
├── lib/index.js             # Host：consent 门禁 + settings 区 + 凭据联动 + 技能注册
├── lib/client.js            # Client（可选）：设置卡片（settings.plugin.item slot，纯 React + 内联样式，不 import 插件包）
├── .dsh/skills/<skill-name>/SKILL.md   # 技能本体（不放仓库根目录）
├── scripts/verify.mjs       # 验证脚本（node --check + mock ctx 单测 + 门禁/设置测试 + 隐私扫描）
├── README.md                # 安装/使用/授权说明 + 免责声明
├── LICENSE / .gitignore / .gitattributes（锁定 LF：* text=auto + eol=lf）
```

关键文件要点：
- `package.json`：`"files"` 显式包含 lib、cordis.patch.yml、SKILL.md、README、LICENSE；`"dsh": { "bundle": {...}, "client": { "platform": "web", "inject": [...] } }`；**零依赖**；`"engines": { "node": ">=20" }`。
- `cordis.patch.yml` 行 id 用**包名**（便于配置覆盖与设置命名空间一致）。
- `lib/index.js`：frontmatter 解析只取 `name/description/whenToUse`；`content` 传正文；`resourceBase: { kind: "directory", path: SKILL_DIR }`。
- `lib/client.js`：必须是 `window.__ModuleLoader__.load({ id, factory: (require) => {...; exports.apply = apply; exports.inject = [...]; return module.exports; } })` 格式；`require("react")` 是平台模块；只注入服务（slots/locale/settingsScope/connection/remote），不 import 其他插件包（client 纯度门）。
- `SKILL.md`：`---` frontmatter 必须含 `name`（kebab-case）与 `description`（非空）。
- `.gitattributes`：`* text=auto` + 各文本类型 `eol=lf`（防止 Windows 克隆变成 CRLF 导致校验失败）。

## 4. 验证（发布前全部通过）

1. `node --check lib/index.js` 与 `node --check lib/client.js`（语法）。
2. `scripts/verify.mjs`：mock `ctx` 断言——host apply 正常、`inject` 含所需服务、技能名/描述/正文/resourceBase 正确、正文已剥离 frontmatter；**consent=false 时不得注册，consent=true 时注册**；settings 区注册（`settings.register` 被调用、schema 可解析、watch 变更后技能注册/注销）；`credentials/updated` 监听已挂；client bundle 可解析、`exports.inject` 含 slots/settingsScope；隐私扫描（token/邮箱/绝对路径）。
3. **组合测试**（不启动 LLM）：`npx -y @deepseek-ai/dsh plugin --profile scratch add <本地路径>` → `npx -y @deepseek-ai/dsh --profile scratch --dump-config`，确认出现插件行与 client 声明。
   - ⚠️ 教训：scratch profile 只有 base 组合，**没有 agent 运行器，不能跑任务**——运行时验证要用 `headless` profile。
4. **运行时验证**（真实激活）：`npx -y @deepseek-ai/dsh plugin --profile headless add <路径或 github:owner/repo>` → `npx -y @deepseek-ai/dsh --profile headless "询问可用技能目录是否包含 <skill-name>"`。门禁插件先测 off（base consent=false → NOT_AVAILABLE），再测 on（consent=true 或 settings 文档 enabled=true → AVAILABLE）。
   - headless 任务耗时长属正常（LLM 调用），后台跑；超 4 分钟无输出先查进程/会话日志，必要时 kill 换前台短任务。
5. 全部通过后再进入发布。

## 5. GitHub 发布

1. **隐私扫描**：`git ls-files` 全量核对；grep 扫描 token 前缀（常见如 `ghp`/`gho`/`ghs`/`ghu`/`github_pat` 开头的长串，通常带下划线分隔）、邮箱、本地盘符路径、用户名；确认无凭据/无个人数据。
2. **git 初始化**：`git init -b main`；提交身份用 GitHub 账号的 no-reply 邮箱或通用身份（不提交真实邮箱）。
3. **建仓**（用进程内凭据，不打印 token）：
   ```powershell
   Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Headers $h -Method Post `
     -Body (@{ name="<repo>"; description="<一句中文+英文描述>"; visibility="public" } | ConvertTo-Json)
   ```
   - 公开发布需**公开仓库**；先与用户确认公开。
4. **打标签（topics，可选但推荐）**：
   ```powershell
   Invoke-RestMethod -Uri "https://api.github.com/repos/<owner>/<repo>/topics" -Headers $h -Method Put `
     -Body (@{ names=@("<主题标签>", "<相关标签>") } | ConvertTo-Json) -ContentType "application/json"
   ```
   - 标签只是仓库元数据，便于被搜索/发现（一些第三方生态工具按 `dsh-plugin` 等标签索引）；不加也不影响官方功能。
5. **推送**：`git remote add origin https://github.com/<owner>/<repo>.git && git push -u origin main`（凭据管理器自动供 token）。
6. **发布后验证**：
   - 匿名 GET `https://api.github.com/repos/<owner>/<repo>` → 200 且 visibility=public；
   - `git clone --depth 1 <url>` 到临时目录 → 运行 `verify.mjs` 全过（验证发布产物，而非工作区未提交文件）。

## 6. 分发与启用

- **安装**（官方路径，无需第三方工具）：
  ```sh
  npx -p @deepseek-ai/dsh dsh plugin --profile web add github:<owner>/<repo>
  ```
  安装完成后**重启 dsh web**。
- **启用（图形化）**：DSH Web GUI → **设置 → 插件配置 → dsh-plugin-publisher** 卡片：
  1. 勾选「启用技能」→ 保存 → 技能 `dsh-plugin-publishing` 立即注册（无需重启）。
  2. 在「GitHub Token」输入框粘贴 PAT → 保存 → 插件自动同步到系统 Git 凭据管理器，`git push` 直接可用（内容不回显）。
- **启用（配置兜底，无 GUI 环境）**：在 profile 的 `cordis.patch.yml` 加直接覆盖条目（勿用 `- insert:`）：
  ```yaml
  - id: dsh-plugin-publisher
    name: dsh-plugin-publisher
    config:
      consent: true
  ```
  或写入设置文档（`~/.dsh/settings.yaml`）：
  ```yaml
  dsh-plugin-publisher:
    enabled: true
  ```
- 插件本体不提供、也不依赖任何第三方"插件市场"；发现/安装一律走官方 `dsh plugin` 命令。

## 7. 授权与安全（写入 README）

- 安装插件=信任该仓库：npm/pnpm 生命周期脚本会在机器上执行（如有）；只安装已审查的仓库。
- 发布操作（建仓/推送/topic）**必须**在用户明确授权后进行；本技能不自动执行任何写操作。
- GitHub Token 只写入 DSH 凭据存储与系统 Git 凭据管理器，插件不记录、不回显、不上传任何数据。
- 免责声明模板见 §0.3，README 必须包含。

## 8. 常见问题与超时处理

| 症状 | 处理 |
| --- | --- |
| headless 任务长时间无输出 | 检查进程存活与 `~/.dsh/logs`；kill 后用更短提示词前台跑；或改 mock 验证 |
| scratch profile 跑任务卡住 | scratch 无 agent 运行器，改用 headless profile |
| 设置页卡片不出现 | 插件需在 web profile 注册且**重启 dsh web**；检查 client bundle rev 是否已加载 |
| 启用开关保存后技能不出现 | 检查 `~/.dsh/settings.yaml` 中 `dsh-plugin-publisher.enabled` 是否落盘；确认 host 日志无注册错误 |
| 克隆后 verify 失败（CRLF） | 加 `.gitattributes` 锁 LF 并 `git add --renormalize` 后重新推送 |
| 启动报 `duplicate loader entry id: <插件名>` | 对已存在行用了 `- insert:`；改成直接覆盖条目（见 §2 patch 层） |
| token 无建仓权限 | 停止 API 建仓，询问用户建仓方式（手动建空仓/换 token） |
| 误提交隐私 | 立即从工作区与远端历史处理：改内容 → `git commit --amend`/新提交 → `git push --force`（需用户授权）；token 立即到 GitHub 撤销（常见 `ghp`/`gho`/`github_pat` 开头） |

## 9. 完成标准

- 环境就绪、零依赖插件构建完成、本地与运行时验证全过（含 consent off/on 两种状态）。
- 隐私扫描无 token/邮箱/本地路径/用户名；README 含授权说明与免责声明。
- 双端插件：host 逻辑 + client 设置卡片（开关 + Token 输入）齐全；设置变更即时生效。
- 仓库公开、推送成功、克隆验证通过；用户已获知设置页启用步骤。
