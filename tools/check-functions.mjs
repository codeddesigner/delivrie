// Fails if any edge function file can't be parsed (the deploy tool doesn't catch this; the function then won't boot).
// Run: node tools/check-functions.mjs   (needs the "typescript" package)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require(path.join(spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim(), "typescript")); }

const root = new URL("../supabase/functions/", import.meta.url).pathname;
const files = fs.readdirSync(root, { recursive: true }).filter((f) => /\.(ts|js)$/.test(f)).map((f) => path.join(root, f));
const tmp = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "fn-check-"));
let bad = 0;
for (const f of files) {
  const out = ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const t = path.join(tmp, "x.mjs"); fs.writeFileSync(t, out);
  const r = spawnSync(process.execPath, ["--check", t], { encoding: "utf8" });
  if (r.status) { bad++; console.log(`FAIL ${path.relative(root, f)}\n${r.stderr.split("\n").slice(0, 5).join("\n")}`); }
}
console.log(bad ? `${bad} file(s) won't parse` : `${files.length} function files parse`);
process.exit(bad ? 1 : 0);
