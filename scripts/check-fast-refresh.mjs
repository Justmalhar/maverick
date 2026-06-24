// Approximates eslint-plugin-react-refresh's only-export-components rule.
// A .tsx module that exports BOTH a React component and a non-component value
// cannot be a Fast Refresh boundary — editing it full-reloads the consuming
// tree (and, in the terminal path, kills live PTYs). Flag those files.
//
// Type-only exports (export type / interface / `type` specifiers) are erased
// at compile time and never break refresh, so they're ignored.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const files = [];
// shadcn primitives in components/ui use the sanctioned cva constant-export
// pattern (allowConstantExport) and are off-limits per CLAUDE.md. They are
// edited rarely enough that the full-reload cost is negligible.
const isExempt = (p) => p.replaceAll("\\", "/").includes("/components/ui/");

(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx") && !isExempt(p)) files.push(p);
  }
})(ROOT);

const isComponentName = (n) => /^[A-Z]/.test(n) && /[a-z]/.test(n);
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const components = [];
  const nonComponents = [];

  for (let raw of src.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("export")) continue;
    if (/^export\s+(type|interface)\b/.test(line)) continue;
    if (/^export\s+\*/.test(line)) continue;

    let m;
    if ((m = line.match(/^export\s+default\s+function\s+([A-Za-z0-9_]+)/))) {
      components.push(m[1]);
    } else if (/^export\s+default\s+(function|class|\()/.test(line) || /^export\s+default\s+[A-Z]/.test(line)) {
      components.push("default");
    } else if ((m = line.match(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/))) {
      (isComponentName(m[1]) ? components : nonComponents).push(m[1]);
    } else if ((m = line.match(/^export\s+const\s+([A-Za-z0-9_]+)/))) {
      (isComponentName(m[1]) ? components : nonComponents).push(m[1]);
    } else if ((m = line.match(/^export\s+class\s+([A-Za-z0-9_]+)/))) {
      nonComponents.push(m[1]);
    } else if ((m = line.match(/^export\s+\{([^}]*)\}/))) {
      for (let spec of m[1].split(",")) {
        spec = spec.trim();
        if (!spec || spec.startsWith("type ")) continue;
        const name = (spec.split(/\s+as\s+/)[1] ?? spec).trim();
        (isComponentName(name) ? components : nonComponents).push(name);
      }
    }
  }

  if (components.length > 0 && nonComponents.length > 0) {
    offenders.push({ file, components, nonComponents });
  }
}

if (offenders.length === 0) {
  console.log("OK: no mixed-export component files found.");
} else {
  console.log(`FAST REFRESH VIOLATIONS: ${offenders.length} file(s)`);
  console.log("Move the non-component exports to a sibling module so the");
  console.log("component file is a Fast Refresh boundary (see leaf-registry.ts).\n");
  for (const o of offenders) {
    console.log(o.file);
    console.log(`  components:     ${o.components.join(", ")}`);
    console.log(`  non-components: ${o.nonComponents.join(", ")}\n`);
  }
  process.exit(1);
}
