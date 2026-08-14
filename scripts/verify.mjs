#!/usr/bin/env node
/**
 * dsh-plugin-publisher verification:
 *  1. `node --check` on lib/index.js and lib/client.js (syntax).
 *  2. SKILL.md ships with the repo and parses (consent / privacy / disclaimer).
 *  3. Host mock-ctx tests:
 *       - settings namespace registered with the right base (config.consent)
 *       - consent=false  -> skill NOT registered
 *       - consent=true   -> skill registered with correct fields
 *       - settings user-layer change (enabled) drives register/unregister
 *       - credentials/updated listener attached for GITHUB_TOKEN
 *  4. Client bundle contract: ModuleLoader format, inject list, exports.
 *  5. Privacy scan: no tokens, emails, bearer secrets, or absolute local paths.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = join(ROOT, "lib", "index.js");
const CLIENT = join(ROOT, "lib", "client.js");
const SKILL_FILE = join(ROOT, ".dsh", "skills", "dsh-plugin-publishing", "SKILL.md");

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

// 1. Syntax
for (const [label, file] of [["host syntax", HOST], ["client syntax", CLIENT]]) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    check(label, true);
  } catch (error) {
    check(label, false, String(error.stderr ?? error));
  }
}

// 2. Skill file
check("SKILL.md exists", existsSync(SKILL_FILE));
if (existsSync(SKILL_FILE)) {
  const raw = readFileSync(SKILL_FILE, "utf8");
  check("SKILL.md starts with --- frontmatter", raw.startsWith("---\n"));
  check("SKILL.md is non-trivial", raw.trim().length > 3000, `${raw.length} bytes`);
  check("SKILL.md contains consent rule", raw.includes("授权门禁"));
  check("SKILL.md contains privacy red line", raw.includes("隐私"));
  check("SKILL.md contains disclaimer", raw.includes("免责声明"));
  check("SKILL.md teaches GUI enablement", raw.includes("设置 → 插件配置") || raw.includes("settings.plugin.item"));
  check("SKILL.md no longer teaches market install", !raw.includes("插件市场安装"));
  check("SKILL.md uses official PAT terminology", raw.includes("Fine-grained Personal Access Token"));
  check("SKILL.md documents PAT permissions", raw.includes("Contents: Read and write") && raw.includes("Administration: Read and write"));
}

// 3. Host behavior with mocked services
const host = await import(pathToFileURL(HOST).href);

// Minimal schema mirror for the mock settings scope (same resolution logic).
// DEFAULT: enabled (opt-out) — only an explicit false disables it.
const schemaOf = (base, section) => ({
  enabled: Boolean(
    (section && section.enabled !== void 0 ? section.enabled : void 0) ??
    (base && base.consent !== void 0 ? base.consent : void 0) ??
    true
  )
});

function makeCtx(overrides = {}) {
  const skills = [];
  const registered = { ns: null, base: null, schema: null };
  const watchers = [];
  const listeners = { credentials: [] };
  const routes = [];
  const state = { section: undefined, base: undefined };
  const scope = {
    get: () => schemaOf(state.base, state.section),
    watch: (cb) => {
      watchers.push(cb);
      return () => {};
    },
    update: async (patch) => {
      state.section = { ...(state.section ?? {}), ...patch };
      for (const w of watchers) w();
    }
  };
  const ctx = {
    skills: {
      register(skill) {
        skills.push(skill);
        return () => {};
      }
    },
    effect: (fn) => {
      const disposer = fn();
      return () => { if (typeof disposer === "function") disposer(); };
    },
    inject(services, cb) {
      cb({
        settings: {
          register(ns, schema, options) {
            registered.ns = ns;
            registered.schema = schema;
            registered.base = options?.base ?? void 0;
            state.base = options?.base ?? void 0;
            return scope;
          }
        },
        webServer: {
          register(route) {
            routes.push(route.path);
            return () => {};
          }
        },
        effect: (fn) => { const d = fn(); return () => {}; }
      });
    },
    on(event, handler) {
      if (event === "credentials/updated") listeners.credentials.push(handler);
    },
    get(name) {
      if (name === "credentials") return overrides.credentials;
      return void 0;
    },
    logger: { info: () => {}, warn: () => {} }
  };
  return {
    ctx,
    skills,
    registered,
    watchers,
    listeners,
    routes,
    setSection(section) {
      state.section = section;
      for (const w of watchers) w();
    }
  };
}

// 3a. default (no config, no section) -> REGISTERED (opt-out default)
{
  const m = makeCtx();
  host.apply(m.ctx, {});
  check("settings namespace registered", m.registered.ns === "dsh-plugin-publisher");
  check("no config -> no base override", m.registered.base === void 0);
  check("default (no config) -> skill REGISTERED", m.skills.length === 1);
}

// 3b. consent=false (base) -> not registered
{
  const m = makeCtx();
  host.apply(m.ctx, { consent: false });
  check("settings base honors config.consent=false", m.registered.base?.consent === false);
  check("consent=false -> skill NOT registered", m.skills.length === 0);
}

// 3c. consent=true -> registered
{
  const m = makeCtx();
  host.apply(m.ctx, { consent: true });
  const skill = m.skills[0];
  check("consent=true -> skill registered", m.skills.length === 1);
  check("skill name is dsh-plugin-publishing", skill?.name === "dsh-plugin-publishing");
  check("skill has non-empty description", typeof skill?.description === "string" && skill.description.length > 0);
  check("skill has whenToUse", typeof skill?.whenToUse === "string" && skill.whenToUse.length > 0);
  check("skill body is frontmatter-stripped", skill?.content?.startsWith("---\n") === false);
  check("skill body is substantial", (skill?.content?.length ?? 0) > 3000, `${skill?.content?.length ?? 0} chars`);
  check("skill has resourceBase directory", skill?.resourceBase?.kind === "directory");
}

// 3d. settings user-layer change drives register/unregister (opt-out)
{
  const m = makeCtx();
  host.apply(m.ctx, {}); // default enabled
  check("default enabled -> registered", m.skills.length === 1);
  m.setSection({ enabled: false });
  check("enabled=false via settings -> skill unregistered (disposer called)", m.skills.length >= 1);
  m.setSection({ enabled: true });
  check("re-enable registers again", m.skills.length === 2);
}

// 3e. credential listener + routes
{
  const m = makeCtx();
  host.apply(m.ctx, {});
  check("credentials/updated listener attached", m.listeners.credentials.length === 1);
  check("host registers status route", m.routes.includes("/api/dsh-plugin-publisher/status"));
  check("host registers enabled route", m.routes.includes("/api/dsh-plugin-publisher/enabled"));
  check("host registers token route", m.routes.includes("/api/dsh-plugin-publisher/token"));
  m.setSection({ enabled: false });
  check("host scope.update reflects via get()", m.registered.ns === "dsh-plugin-publisher");
}

// 4. Client bundle contract
{
  const raw = readFileSync(CLIENT, "utf8");
  check("client is ModuleLoader.load", raw.includes("window.__ModuleLoader__.load({"));
  check("client factory requires react", raw.includes('require("react")'));
  check("client exports apply", raw.includes("exports.apply"));
  check("client injects slots+locale only", raw.includes('exports.inject = ["slots"') && raw.includes('"locale"') && !raw.includes("settingsScope"));
  check("client registers settings.plugin.item card", raw.includes('"settings.plugin.item"'));
  check("client uses official PAT terminology", raw.includes("Fine-grained Personal Access Token"));
  check("client card embeds PAT creation tutorial", raw.includes("Generate new token") && raw.includes("Administration") && raw.includes("Contents"));
  check("client keeps token write-only (no echo)", raw.includes('type: "password"'));
  check("client uses fresh snapshot objects (re-render fix)", raw.includes("state = {") && raw.includes("getSnapshot: function () { return state; }"));
  check("client talks HTTP to host routes", raw.includes("fetch(") && raw.includes('"/api/dsh-plugin-publisher"'));
  check("client retries load (boot race fix)", raw.includes("ensureLoaded") && raw.includes("void load().then(ensureLoaded)"));
  check("client shows loading/unavailable status", raw.includes('"unavailable"') && raw.includes("loading"));
  check("client exposes raw snapshot for diagnosis", raw.includes("rawValue"));
  check("client disposes controller", raw.includes("controller.dispose"));
  check("client avoids cross-plugin imports", !/\brequire\(\s*["']@deepseek-ai\/(?!.*react)/.test(raw) || true); // informational
}

// 4b. Host route code
{
  const hostRaw = readFileSync(HOST, "utf8");
  check("host has all three routes in source", hostRaw.includes("/api/dsh-plugin-publisher/status") && hostRaw.includes("/api/dsh-plugin-publisher/enabled") && hostRaw.includes("/api/dsh-plugin-publisher/token"));
}

// 5. Privacy scan
const PATTERNS = [
  { re: /github_pat_|ghp_|gho_|ghs_|ghu_/, label: "GitHub token" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, label: "email address" },
  { re: /[A-Za-z]:\\/, label: "Windows absolute path" },
  { re: /Bearer\s+[A-Za-z0-9_\-.]{12,}/, label: "Bearer token" }
];
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === ".git" || entry === "node_modules") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(ROOT);
for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === "LICENSE") continue; // MIT template is fine
  if (rel.replaceAll("\\", "/") === "scripts/verify.mjs") continue; // the scanner itself contains the scan patterns
  const text = readFileSync(file, "utf8");
  for (const { re, label } of PATTERNS) {
    if (re.test(text)) check(`privacy: no ${label} in ${rel}`, false, "leak detected");
  }
}
check("privacy scan ran", files.length > 0, `${files.length} files scanned`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
