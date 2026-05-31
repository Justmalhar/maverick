// Ready-to-add Model Context Protocol servers. Each is the canonical npx
// invocation of an @modelcontextprotocol reference server, so a user can wire a
// common capability (files, git, sqlite, fetch) without memorising the package.
export interface MCPPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const MCP_PRESETS: MCPPreset[] = [
  {
    id: "filesystem",
    name: "filesystem",
    description: "Read/write files under an allowed root",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  },
  {
    id: "git",
    name: "git",
    description: "Inspect and operate on a git repository",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git", "--repository", "."],
  },
  {
    id: "sqlite",
    name: "sqlite",
    description: "Query a local SQLite database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./data.db"],
  },
  {
    id: "fetch",
    name: "fetch",
    description: "Fetch and convert web pages to markdown",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
  },
];
