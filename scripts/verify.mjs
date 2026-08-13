#!/usr/bin/env node
/**
 * dsh-plugin-publisher verification:
 *  1. `node --check` on the plugin entry (syntax).
 *  2. SKILL.md ships with the repo and parses.
 *  3. Mock-ctx unit tests, INCLUDING the consent gate:
 *       - apply({ consent: false })  -> skill NOT registered, no throw
 *       - apply({ consent: true })   -> skill registered with correct fields
 *  4. Privacy scan: the repo must not contain credentials, tokens,
 *     personal emails, or absolute local paths.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "lib", "index.js");
const SKILL_FILE = join(ROOT, ".dsh", "skills", "dsh-plugin-publishing", "SKILL.md");

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

// 1. Syntax
try {
  execFileSync(process.execPath, ["--check", PLUGIN], { stdio: "pipe" });
  check("plugin syntax (node --check)", true);
} catch (error) {
  check("plugin syntax (node --check)", false, String(error.stderr ?? error));
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
  check("SKILL.md contains marketplace topic guidance", raw.includes("dsh-plugin"));
}

// 3. Consent-gated registration with mocked ctx
const plugin = await import(pathToFileURL(PLUGIN).href);
function makeCtx() {
  const calls = [];
  return {
    calls,
    skills: {
      register(skill) { calls.push(skill); return () => {}; }
    },
    effect: (fn) => fn(),
    logger: { info: () => {}, warn: () => {} }
  };
}

const offCtx = makeCtx();
plugin.apply(offCtx, { consent: false });
check("consent=false -> skill NOT registered", offCtx.calls.length === 0);

const onCtx = makeCtx();
plugin.apply(onCtx, { consent: true });
const reg = onCtx.calls[0];
check("consent=true -> skill registered", onCtx.calls.length === 1);
check("skill name is dsh-plugin-publishing", reg?.name === "dsh-plugin-publishing");
check("skill has non-empty description", typeof reg?.description === "string" && reg.description.length > 0);
check("skill has whenToUse", typeof reg?.whenToUse === "string" && reg.whenToUse.length > 0);
check("skill body is frontmatter-stripped", reg?.content?.startsWith("---\n") === false);
check("skill body is substantial", (reg?.content?.length ?? 0) > 3000, `${reg?.content?.length ?? 0} chars`);
check("inject declares skills service", Array.isArray(plugin.inject) && plugin.inject.includes("skills"));

// 4. Privacy scan over tracked file candidates
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
