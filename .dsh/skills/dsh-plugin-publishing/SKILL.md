---
name: dsh-plugin-publishing
description: DeepSeek Harness (DSH) 插件开发与 GitHub 发布完整工作流技能。用于把技能/功能打包成 DSH 插件（cordis 插件、零依赖、consent 授权门禁），本地验证，发布到 GitHub（建公开仓库、打 dsh-plugin topic、推送），并让第三方插件市场收录可见。含隐私红线、免责声明与超时处理。注意：本技能由 dsh-plugin-publisher 插件提供，只有用户在配置中显式开启 consent 后才会注册。
whenToUse: 当需要开发一个新的 DSH 插件、把已有技能打包成插件、发布插件到 GitHub、让插件出现在 DSH 插件市场，或复现"插件开发→验证→发布→市场可见"全流程时。
---

# DSH 插件开发与 GitHub 发布工作流

## 0. 铁律（动手前必读）

1. **用户授权门禁**：创建公开仓库、推送代码、修改 GitHub 上的任何东西，都是**写操作**。开始前必须获得用户明确同意（确认目标账号、仓库名、公开可见性）。用户未授权时只做只读调研与本地构建。本技能所在的插件本身也受 `config.consent` 门禁保护，默认关闭。
2. **隐私红线（绝不违反）**：
   - 绝不把 token / 密钥 / 凭据 / .credentials.yaml 内容 / 会话数据写进仓库、README、技能或任何提交。
   - 代码里的认证信息必须用占位符（如 `<owner>/<repo>`），检测凭据时**不得回显 token**（只输出账号名与状态码）。
   - 不提交本地绝对路径（如 `<盘符>:\<路径>`、`/home/<用户>/<路径>` 这类形态）、用户名、邮箱等个人可识别信息；技能/README 用通用占位符。
   - 发布前用 `git ls-files` 与全文搜索（token 前缀、邮箱、绝对路径）做一次隐私扫描。
3. **免责声明（写入 README 与技能）**：本流程会创建公开仓库并推送代码，代码一经公开不可撤回；发布操作仅由用户明确授权后执行；对第三方插件市场仅提供发现/安装便利，与官方及本技能无关联，不提供任何担保；因发布或安装造成的损失由使用者自行承担。
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
  # 建一个 private 探测仓再删除，确认 Administration/建仓权限
  ```
- 无可用凭据 → **停下来询问用户**提供方式（PAT / gh CLI 登录 / SSH），不自行猜测。

## 2. DSH 插件架构速查（契约）

- **Bundle**：作者分发的包，`package.json` 的 `dsh.bundle.patch` 指向配置层。
- **Profile**：用户运行的组合，`dsh.profile.bundles` 保存有序 bundle 列表；**不要手写**用户 profile manifest。
- **Patch 层**（`cordis.patch.yml`，顶层数组）：`- insert: - id: <行id>, name: <包名>, config: {...}`；`id` 是稳定行身份，后层按 id 整段替换 config。
- **生效顺序**：profile bundles → profile cordis.patch.yml → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`（后者胜）。
- **Host-only 插件**：不声明 `dsh.client`，不构建 client bundle；只需 `inject` 需要的 service（如 `["skills"]`）。
- **运行时技能注册**（`ctx.skills.register`）契约：`{ name, description, whenToUse?, content, source, invocation?, resourceBase? }`；`source` 必须是非空字符串；`content` 传 frontmatter 剥离后的正文（与文件系统技能一致）；返回 disposer，用 `ctx.effect(() => disposer, label)` 绑定生命周期。同名技能 first-wins（项目层 > 运行时层）。
- **零依赖策略**：只用 Node 内置模块 + 注入的 service，`package.json` 不写 dependencies/peerDependencies → 插件市场安装时跳过 npm install、无生命周期脚本确认弹窗。
- **consent 门禁模式**：`config.consent === true` 才注册技能/执行逻辑，默认 false 并打印开启指引——涉及公开发布的插件必须如此。

## 3. 开发步骤（标准结构）

```
<repo>/                      # 仓库名：dsh-<功能>（npm 合法包名）
├── package.json             # cordis 插件清单：type module、main、exports、files、dsh.bundle.patch、零依赖
├── cordis.patch.yml         # 配置层（含 consent: false 默认）
├── lib/index.js             # Host 插件：consent 门禁 + 读取 SKILL.md + ctx.skills.register
├── .dsh/skills/<skill-name>/SKILL.md   # 技能本体（不放仓库根目录，避免市场误判为 skill 类型）
├── scripts/verify.mjs       # 验证脚本（node --check + mock ctx 单测 + 门禁测试）
├── README.md                # 安装/使用/授权说明 + 免责声明
├── LICENSE / .gitignore / .gitattributes（锁定 LF：* text=auto + eol=lf）
```

关键文件要点：
- `package.json`：`"files"` 显式包含 lib、cordis.patch.yml、SKILL.md 路径、README、LICENSE；`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；**零依赖**；`"engines": { "node": ">=20" }`。
- `cordis.patch.yml` 行 id 用**包名**（与市场安装时 slug 一致，便于覆盖配置）。
- `lib/index.js`：frontmatter 解析只取 `name/description/whenToUse`；`content` 传正文；`resourceBase: { kind: "directory", path: SKILL_DIR }`。
- `SKILL.md`：`---` frontmatter 必须含 `name`（kebab-case）与 `description`（非空）。
- `.gitattributes`：`* text=auto` + 各文本类型 `eol=lf`（防止 Windows 克隆变成 CRLF 导致校验失败）。

## 4. 验证（发布前全部通过）

1. `node --check lib/index.js`（语法）。
2. `scripts/verify.mjs`：mock `ctx` 断言——apply 正常、`inject` 含 skills、技能名/描述/正文/ resourceBase 正确、正文已剥离 frontmatter；**consent=false 时不得注册，consent=true 时注册**；`node --check` 子进程。
3. **组合测试**（不启动 LLM）：`npx -y @deepseek-ai/dsh plugin --profile scratch add <本地路径>` → `npx -y @deepseek-ai/dsh --profile scratch --dump-config`，确认出现插件行。
   - ⚠️ 教训：scratch profile 只有 base 组合，**没有 agent 运行器，不能跑任务**——运行时验证要用 `headless` profile。
4. **运行时验证**（真实激活）：`npx -y @deepseek-ai/dsh plugin --profile headless add <路径或 github:owner/repo>` → `npx -y @deepseek-ai/dsh --profile headless "询问可用技能目录是否包含 <skill-name>"`，确认代理回答包含该技能（门禁插件先测 off → NOT_AVAILABLE，再开启 consent 测 on → AVAILABLE）。
   - headless 任务耗时长属正常（LLM 调用），后台跑；超 4 分钟无输出先查进程/会话日志，必要时 kill 换前台短任务。
5. 全部通过后再进入发布。

## 5. GitHub 发布

1. **隐私扫描**：`git ls-files` 全量核对；grep 扫描 token 前缀（常见如 `ghp`/`gho`/`ghs`/`ghu`/`github_pat` 开头的长串，通常带下划线分隔）、邮箱、本地盘符路径、用户名；确认无凭据/无个人数据。
2. **git 初始化**：`git init -b main`；配置提交身份用 GitHub 账号的 no-reply 邮箱（不提交真实邮箱）。
3. **建仓**（用进程内凭据，不打印 token）：
   ```powershell
   Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Headers $h -Method Post `
     -Body (@{ name="<repo>"; description="<一句中文+英文描述>"; visibility="public" } | ConvertTo-Json)
   ```
   - 市场可见性要求**公开仓库**；先与用户确认公开。
4. **打标签（topics）**——市场可见性的关键：
   ```powershell
   Invoke-RestMethod -Uri "https://api.github.com/repos/<owner>/<repo>/topics" -Headers $h -Method Put `
     -Body (@{ names=@("dsh-plugin", "<相关标签>") } | ConvertTo-Json) -ContentType "application/json"
   ```
   - **`dsh-plugin` 是插件市场的索引标签，必打**；可加 godot、game-development 等主题标签。
5. **推送**：`git remote add origin https://github.com/<owner>/<repo>.git && git push -u origin main`（凭据管理器自动供 token）。
6. **发布后验证**：
   - 匿名 GET `https://api.github.com/repos/<owner>/<repo>` → 200 且 visibility=public；
   - GET `/repos/<owner>/<repo>/topics` 确认含 `dsh-plugin`；
   - `git clone --depth 1 <url>` 到临时目录 → 运行 `verify.mjs` 全过（验证发布产物，而非工作区未提交文件）。

## 6. 插件市场可见性与安装

- 第三方市场（如 dsh-plugin-marketplace）从 GitHub **`topic:dsh-plugin`** 拉索引：静态 `registry.json`（CDN，GitHub Actions **每 2 小时重建**）优先，GitHub 搜索 API 兜底。
- **时间线**：新仓库最迟 **2 小时内**进入市场索引；GitHub 搜索索引对新建 topic 也有几分钟~1 小时延迟，属正常，不要误判为失败。
- 验证市场接口：`GET http://127.0.0.1:3080/api/marketplace/list` 搜索仓库名；未出现就等窗口，或在市场页点「刷新」。
- 市场一键安装等价于：`git clone` → 类型识别（根 SKILL.md=skill；package.json=cordis 插件）→ （有依赖才 npm install，零依赖跳过）→ 复制到 `profiles/web/node_modules/<包名>` → 追加 patch 行 → 写 `installed.json`。
- 安装后**需重启 dsh** 生效；consent 门禁插件默认不注册技能，用户按 README 开启后再重启。

## 7. 授权与安全（写入 README）

- 插件安装=信任该仓库：市场会执行仓库内的安装脚本或 npm 生命周期脚本（有则先弹确认）；只安装已审查的仓库。
- 发布操作（建仓/推送/topic）**必须**在用户明确授权后进行；本技能不自动执行任何写操作。
- API Key 等材料只作为本次安装的环境变量传入，不持久化；插件自身不收集任何数据。
- 免责声明模板见 §0.3，README 必须包含。

## 8. 常见问题与超时处理

| 症状 | 处理 |
| --- | --- |
| headless 任务长时间无输出 | 检查进程存活与 `~/.dsh/logs`；kill 后用更短提示词前台跑；或改 mock 验证 |
| scratch profile 跑任务卡住 | scratch 无 agent 运行器，改用 headless profile |
| GitHub 搜索/市场看不到新仓库 | topic 已设即可；搜索索引延迟几分钟~1h，市场 registry 2h 内重建 |
| 克隆后 verify 失败（CRLF） | 加 `.gitattributes` 锁 LF 并 `git add --renormalize` 后重新推送 |
| token 无建仓权限 | 停止 API 建仓，询问用户建仓方式（手动建空仓/换 token） |
| 市场安装被拒（依赖/脚本） | 零依赖插件无此问题；有依赖时需用户确认 npm 脚本 |
| 误提交隐私 | 立即从工作区与远端历史处理：改内容 → `git commit --amend`/新提交 → `git push --force`（需用户授权）；token 立即到 GitHub 撤销（常见 `ghp`/`gho`/`github_pat` 开头） |

## 9. 完成标准

- 环境就绪、零依赖插件构建完成、本地与运行时验证全过（含 consent off/on 两种状态）。
- 隐私扫描无 token/邮箱/本地路径/用户名；README 含授权说明与免责声明。
- 仓库公开、`dsh-plugin` topic 已打、推送成功、克隆验证通过。
- 用户已获知市场收录时间线与启用 consent 的步骤。
