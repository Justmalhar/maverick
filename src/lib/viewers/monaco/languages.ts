// Shiki language ids per extension. Grammars lazy-load on first use; anything
// unmapped renders as plaintext rather than failing.
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx",
  json: "json", jsonc: "jsonc",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html",
  md: "markdown", markdown: "markdown", mdx: "mdx",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  xml: "xml", svg: "xml", plist: "xml",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql", gql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  tf: "hcl",
  proto: "proto",
  ini: "ini", conf: "ini", env: "ini",
};

const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
};

export const SHIKI_LANGS: string[] = [...new Set([
  ...Object.values(EXT_TO_LANG),
  ...Object.values(FILENAME_TO_LANG),
])];

export function languageForPath(path: string): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (FILENAME_TO_LANG[name]) return FILENAME_TO_LANG[name];
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}
