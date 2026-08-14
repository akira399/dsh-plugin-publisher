/**
 * dsh-plugin-publisher — DeepSeek Harness (DSH) host plugin.
 *
 * Capabilities (all consent-gated through the settings section):
 *   1. Registers a settings namespace `dsh-plugin-publisher` with an `enabled`
 *      flag. The web GUI (lib/client.js) renders it as an "enable" toggle on
 *      the 设置 → 插件配置 page. The skill `dsh-plugin-publishing` is ONLY
 *      registered while `enabled` is true.
 *   2. Watches the `GITHUB_TOKEN` credential (entered in the GUI) and mirrors
 *      it into the system Git credential manager (`git credential approve`),
 *      so `git push`/`git clone` to GitHub work in sessions without further
 *      setup. The token value is never logged or echoed.
 *   3. Exposes loopback HTTP routes for the settings card:
 *        GET  /api/dsh-plugin-publisher/status  → { resolved, tokenConfigured }
 *        POST /api/dsh-plugin-publisher/enabled → { enabled } (writes settings)
 *        POST /api/dsh-plugin-publisher/token   → { token }  (writes credential)
 *      The card talks to these directly, so it does not depend on the client
 *      settings/credentials RPC channels.
 *
 * Fallback: the composition entry's `config.consent: true` acts as the base
 * layer, so config-file installs (e.g. headless profiles) can still enable the
 * skill without the GUI.
 *
 * Privacy: this plugin never reads, stores, or transmits credentials, tokens,
 * session data, or local paths beyond what the user explicitly configured.
 * The token travels only from the credentials store to the OS credential
 * manager.
 *
 * Zero npm dependencies: Node builtins + injected services only.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-plugin-publisher";

/** Services this plugin requires; the fiber stays pending until they exist. */
export const inject = ["skills"];

/** Settings namespace owning this plugin's `enabled` flag. */
const NS = "dsh-plugin-publisher";
/** Credential reference for the GitHub token entered in the GUI. */
const CRED_REF = "GITHUB_TOKEN";
/** Git credential entry this plugin maintains. */
const GIT_CREDENTIAL = {
  protocol: "https",
  host: "github.com",
  username: "x-access-token"
};

const SKILL_NAME = "dsh-plugin-publishing";
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".dsh", "skills", SKILL_NAME);
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");
const SOURCE = "dsh-plugin-publisher";

/**
 * Minimal schemastery-shaped schema for the settings section.
 * Resolution: schema defaults → composition `base` → user document.
 * `enabled` honors both the GUI flag and the legacy `consent` config key.
 *
 * DEFAULT: enabled (opt-out). The skill is registered by default and stays
 * registered across refreshes; only an explicit user choice (GUI toggle or a
 * `consent: false` / `enabled: false` override) disables it.
 */
const schema = Object.assign(
  (value) => ({ enabled: Boolean(value?.enabled ?? value?.consent ?? true) }),
  { toJSON: () => ({ type: "object", dict: { enabled: { type: "boolean" } } }) }
);

/** Minimal YAML-frontmatter parser: extracts `name`, `description`, `whenToUse`. */
function parseFrontmatter(text) {
  const firstLineEnd = text.indexOf("\n");
  const isFenced = firstLineEnd >= 0 && text.slice(0, firstLineEnd).replace(/\r$/, "") === "---";
  if (!isFenced) return { data: {}, body: text.trim() };
  const end = text.indexOf("\n---", firstLineEnd + 1);
  const body = end === -1 ? "" : text.slice(end + 4).trim();
  const header = text.slice(firstLineEnd + 1, end === -1 ? text.length : end);
  const data = {};
  for (const rawLine of header.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === "name" || key === "description" || key === "whenToUse") data[key] = value;
  }
  return { data, body };
}

function loggerOf(ctx) {
  return typeof ctx.logger?.info === "function"
    ? (msg) => ctx.logger.info(`[${name}] ${msg}`)
    : (msg) => console.log(`[${name}] ${msg}`);
}

/** Mirror the stored token into the system Git credential manager. */
function gitCredentialApprove(token) {
  const payload = `${GIT_CREDENTIAL.protocol}\nhost=${GIT_CREDENTIAL.host}\nusername=${GIT_CREDENTIAL.username}\npassword=${token}\n\n`;
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["credential", "approve"], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git credential approve exited ${code}: ${stderr}`.trim()));
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

export function apply(ctx, config = {}) {
  const log = loggerOf(ctx);
  let skillEffect = null;
  let registered = false;

  const buildSkill = () => {
    const raw = readFileSync(SKILL_FILE, "utf8");
    const { data, body } = parseFrontmatter(raw);
    return {
      name: data.name?.trim() || SKILL_NAME,
      description: data.description?.trim() || "DSH plugin development & GitHub publishing workflow skill for DeepSeek Harness.",
      ...(data.whenToUse?.trim() ? { whenToUse: data.whenToUse.trim() } : {}),
      content: body,
      source: SOURCE,
      metadata: {
        version: "1.0.0",
        defaultEnabled: true
      },
      resourceBase: {
        kind: "directory",
        path: SKILL_DIR
      }
    };
  };

  /** Register or unregister the skill following the `enabled` flag. */
  const sync = (enabled) => {
    if (enabled && !skillEffect) {
      try {
        const disposer = ctx.skills.register(buildSkill());
        skillEffect = ctx.effect(() => disposer, `${name}: register skill ${SKILL_NAME}`);
        registered = true;
        log(`技能 "${SKILL_NAME}" 已启用并注册。`);
      } catch (error) {
        log(`技能注册失败：${error}`);
      }
    } else if (!enabled && skillEffect) {
      skillEffect();
      skillEffect = null;
      registered = false;
      log(`技能 "${SKILL_NAME}" 已停用并注销。`);
    }
  };

  // 1) Settings section: GUI toggle (设置 → 插件配置 → dsh-plugin-publisher).
  let statusScope = null;
  ctx.inject(["settings"], (sctx) => {
    // Default: enabled (opt-out). Only an explicit `consent` config override
    // becomes the base layer; otherwise the schema default (true) applies.
    const base = typeof config?.consent === "boolean" ? { consent: config.consent === true } : void 0;
    const scope = sctx.settings.register(NS, schema, {
      ...(base === void 0 ? {} : { base })
    });
    statusScope = scope;
    sync(scope.get()?.enabled ?? true);
    scope.watch(() => sync(scope.get()?.enabled ?? true));
  });

  // 1b) Loopback HTTP routes for the settings card. The card talks to these
  // directly so it does not depend on the client settings/credentials RPCs.
  ctx.inject(["webServer"], (wctx) => {
    const register = (path, handler) => {
      wctx.effect(() => wctx.webServer.register({
        kind: "exact",
        path,
        handler
      }), `${name}: route ${path}`);
    };
    const writeJson = (res, status, value) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(value));
    };
    const readJsonBody = (req) => new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1e6) {
          reject(new Error("request body too large"));
          req.destroy();
        }
      });
      req.on("end", () => {
        try { resolve(data.length > 0 ? JSON.parse(data) : {}); } catch { reject(new Error("invalid JSON body")); }
      });
      req.on("error", reject);
    });
    // CSRF/dns-rebinding fence: same custom-header model as other loopback APIs.
    const trusted = (req) => req.headers["x-dsh-plugin-publisher"] === "1";

    register("/api/dsh-plugin-publisher/status", async (req, res) => {
      if (req.method !== "GET") return writeJson(res, 405, { ok: false, error: "method not allowed" });
      let tokenConfigured = false;
      try {
        const credentials = ctx.get("credentials");
        const resolved = credentials === void 0 ? void 0 : await credentials.resolve(CRED_REF);
        tokenConfigured = Boolean(resolved?.value?.length > 0);
      } catch { /* report false */ }
      writeJson(res, 200, {
        ok: true,
        plugin: name,
        version: "1.4.0",
        settingsNamespace: NS,
        registered: statusScope !== null,
        resolved: statusScope ? statusScope.get() : void 0,
        tokenConfigured
      });
    });

    register("/api/dsh-plugin-publisher/enabled", async (req, res) => {
      if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method not allowed" });
      if (!trusted(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
      let body;
      try { body = await readJsonBody(req); } catch (error) { return writeJson(res, 400, { ok: false, error: String(error.message ?? error) }); }
      if (statusScope === null) return writeJson(res, 503, { ok: false, error: "settings not ready" });
      const enabled = body?.enabled === true;
      try {
        await statusScope.update({ enabled });
        writeJson(res, 200, { ok: true, enabled: statusScope.get().enabled });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error.message ?? error) });
      }
    });

    register("/api/dsh-plugin-publisher/token", async (req, res) => {
      if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method not allowed" });
      if (!trusted(req)) return writeJson(res, 403, { ok: false, error: "forbidden" });
      let body;
      try { body = await readJsonBody(req); } catch (error) { return writeJson(res, 400, { ok: false, error: String(error.message ?? error) }); }
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (token.length === 0) return writeJson(res, 400, { ok: false, error: "empty token" });
      try {
        const credentials = ctx.get("credentials");
        if (credentials === void 0) return writeJson(res, 503, { ok: false, error: "credentials service unavailable" });
        await credentials.set(CRED_REF, token);
        await syncGitCredential();
        writeJson(res, 200, { ok: true, configured: true });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error.message ?? error) });
      }
    });
  }, () => {
    log("webServer 服务不可用，设置卡片路由未注册（不影响技能注册）。");
  });

  // 2) Credential → system Git credential manager bridge.
  const syncGitCredential = async () => {
    try {
      const credentials = ctx.get("credentials");
      if (credentials === void 0) return;
      const resolved = await credentials.resolve(CRED_REF);
      if (resolved?.value === void 0 || resolved.value.length === 0) return;
      await gitCredentialApprove(resolved.value);
      log(`"${CRED_REF}" 已同步到系统 Git 凭据管理器（github.com）。`);
    } catch (error) {
      log(`"${CRED_REF}" 同步到 Git 凭据管理器失败：${error}`);
    }
  };
  ctx.on("credentials/updated", (ref) => {
    if (ref === CRED_REF) void syncGitCredential();
  });
  void syncGitCredential();
}
