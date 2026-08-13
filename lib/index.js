/**
 * dsh-plugin-publisher — DeepSeek Harness (DSH) host plugin.
 *
 * Consent-gated runtime skill registration:
 *   - Reads the bundled workflow skill (`.dsh/skills/dsh-plugin-publishing/SKILL.md`).
 *   - Registers it via `ctx.skills.register(...)` ONLY when the user has
 *     explicitly opted in through `config.consent === true`.
 *
 * Why the gate: the skill drives operations that CREATE PUBLIC GitHub
 * repositories and PUSH CODE. It must never be active implicitly — the user
 * has to actively enable it (see cordis.patch.yml for instructions).
 *
 * Privacy: this plugin never reads, stores, or transmits credentials, tokens,
 * session data, or local paths. It only carries the skill's own text.
 *
 * Zero npm dependencies: only Node builtins + the `skills` service.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-plugin-publisher";

/** Services this plugin requires; the fiber stays pending until they exist. */
export const inject = ["skills"];

const SKILL_NAME = "dsh-plugin-publishing";
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".dsh", "skills", SKILL_NAME);
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");
const SOURCE = "dsh-plugin-publisher";

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

export function apply(ctx, config = {}) {
  // ⚠️ Consent gate: never register while the user has not opted in.
  const consent = config?.consent === true;
  const log = typeof ctx.logger?.info === "function"
    ? (msg) => ctx.logger.info(`[${name}] ${msg}`)
    : (msg) => console.log(`[${name}] ${msg}`);

  if (!consent) {
    log("consent 未开启（config.consent=false），技能未注册。");
    log("如需启用：在 profile 的 cordis.patch.yml 中把 dsh-plugin-publisher 行的 config.consent 设为 true，然后重启 dsh。");
    log("技能涉及创建公开 GitHub 仓库与推送代码，必须由用户主动授权。");
    return;
  }

  const raw = readFileSync(SKILL_FILE, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const description = data.description?.trim()
    || "DSH plugin development & GitHub publishing workflow skill for DeepSeek Harness.";
  const skill = {
    name: data.name?.trim() || SKILL_NAME,
    description,
    ...(data.whenToUse?.trim() ? { whenToUse: data.whenToUse.trim() } : {}),
    content: body,
    source: SOURCE,
    metadata: {
      version: "1.0.0",
      consentRequired: true
    },
    resourceBase: {
      kind: "directory",
      path: SKILL_DIR
    }
  };

  const disposer = ctx.skills.register(skill);
  ctx.effect(() => disposer, `${name}: register skill ${skill.name}`);
  log(`consent 已开启，技能 "${skill.name}" 已注册。`);
}
