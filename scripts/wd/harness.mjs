// Real WebView2 driver for Maverick via tauri-driver + msedgedriver.
// Raw W3C WebDriver over fetch — no npm deps. Launches the debug binary
// (which loads the vite dev server on :1420) and drives literal clicks.
//
// Usage: bun scripts/wd/harness.mjs <batch>
//   batch ∈ nav | overlays | kanban | mcps | skills | settings | git | all

const WD = "http://127.0.0.1:4444";
const APP = "C:\\Users\\manan\\desktop\\Maverick-Windows\\src-tauri\\target\\debug\\maverick.exe";
const EL = "element-6066-11e4-a52e-4f735466cecf";
const SHOT_DIR = process.env.TEMP + "\\mvk-wd";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rq(method, path, body) {
  const res = await fetch(WD + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || (json && json.value && json.value.error)) {
    const err = new Error(`WD ${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    err.wd = json;
    throw err;
  }
  return json.value;
}

class Driver {
  sid = null;

  async waitForVite(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch("http://127.0.0.1:1420/");
        if (r.ok) return true;
      } catch { /* not up yet */ }
      await sleep(500);
    }
    throw new Error("vite :1420 never came up");
  }

  async start() {
    // tauri-driver reads tauri:options.application and launches it, then
    // proxies to msedgedriver attached to the app's WebView2.
    const caps = {
      capabilities: {
        alwaysMatch: { "tauri:options": { application: APP } },
        firstMatch: [{}],
      },
      // legacy shape some driver versions still read
      desiredCapabilities: { "tauri:options": { application: APP } },
    };
    let lastErr;
    for (let i = 0; i < 5; i++) {
      try {
        const v = await rq("POST", "/session", caps);
        this.sid = v.sessionId;
        return v;
      } catch (e) {
        lastErr = e;
        await sleep(1500);
      }
    }
    throw lastErr;
  }

  async stop() {
    if (this.sid) { try { await rq("DELETE", `/session/${this.sid}`); } catch { /* ignore */ } }
  }

  async findRaw(css) {
    const v = await rq("POST", `/session/${this.sid}/element`, { using: "css selector", value: css });
    return v[EL];
  }

  async waitFor(css, timeoutMs = 8000) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeoutMs) {
      try { return await this.findRaw(css); } catch (e) { last = e; }
      await sleep(250);
    }
    throw new Error(`not found: ${css} (${last?.message ?? ""})`);
  }

  async displayed(css, timeoutMs = 8000) {
    const id = await this.waitFor(css, timeoutMs);
    return await rq("GET", `/session/${this.sid}/element/${id}/displayed`);
  }

  async click(css, timeoutMs = 8000) {
    const id = await this.waitFor(css, timeoutMs);
    await rq("POST", `/session/${this.sid}/element/${id}/click`, {});
    return id;
  }

  async text(css, timeoutMs = 8000) {
    const id = await this.waitFor(css, timeoutMs);
    return await rq("GET", `/session/${this.sid}/element/${id}/text`);
  }

  async type(css, value, timeoutMs = 8000) {
    const id = await this.waitFor(css, timeoutMs);
    await rq("POST", `/session/${this.sid}/element/${id}/value`, { text: value });
  }

  async exec(script, args = []) {
    return await rq("POST", `/session/${this.sid}/execute/sync`, { script, args });
  }

  // WebDriver "is element displayed" returns false for display:none; a missing
  // element throws in waitFor. Either way the element isn't visible to a user.
  async notDisplayed(css, settleMs = 1200) {
    await sleep(settleMs);
    try {
      const id = await this.findRaw(css);
      return !(await rq("GET", `/session/${this.sid}/element/${id}/displayed`));
    } catch { return true; }
  }

  // tinykeys listens on window; real key events from the Actions API reach it.
  // names: ctrl|shift|alt|escape|space, else the literal char ("p", ",", "/").
  static KEY = { ctrl: "", shift: "", alt: "", escape: "", space: " " };
  async chord(...names) {
    const vals = names.map((n) => Driver.KEY[n] ?? n);
    const seq = [];
    for (const v of vals) seq.push({ type: "keyDown", value: v });
    for (const v of [...vals].reverse()) seq.push({ type: "keyUp", value: v });
    await rq("POST", `/session/${this.sid}/actions`, {
      actions: [{ type: "key", id: "kb", actions: seq }],
    });
    await rq("DELETE", `/session/${this.sid}/actions`).catch(() => {});
    await sleep(300);
  }

  async count(css) {
    return await this.exec("return document.querySelectorAll(arguments[0]).length", [css]);
  }

  async shot(name) {
    try {
      const b64 = await rq("GET", `/session/${this.sid}/screenshot`);
      const fs = await import("node:fs");
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      fs.writeFileSync(`${SHOT_DIR}\\${name}.png`, Buffer.from(b64, "base64"));
      return `${SHOT_DIR}\\${name}.png`;
    } catch (e) { return `shot-failed: ${e.message}`; }
  }
}

// ---- feature manifests -------------------------------------------------

const NAV = [
  ["dashboard", "dashboard-view"],
  ["usage", "usage-panel"],
  ["kanban", "kanban-board"],
  ["automations", "automations-panel"],
  ["mcps", "mcps-panel"],
  ["skills", "skills-panel"],
];

function navTests() {
  return NAV.map(([tab, panel]) => ({
    name: `nav: click sidebar-nav-${tab} -> ${panel} visible`,
    async run(d) {
      await d.click(`[data-testid='sidebar-nav-${tab}']`);
      const shown = await d.displayed(`[data-testid='${panel}']`);
      if (!shown) throw new Error(`${panel} present but not displayed after clicking ${tab}`);
    },
  }));
}

function overlayTests() {
  const open = (chord, sel, label) => ({
    name: `overlay: ${label} opens (${chord.join("+")}) and closes (Esc)`,
    async run(d) {
      await d.chord(...chord);
      const shown = await d.displayed(`[data-testid='${sel}']`, 4000);
      if (!shown) throw new Error(`${sel} not displayed after ${chord.join("+")}`);
      await d.chord("escape");
      if (!(await d.notDisplayed(`[data-testid='${sel}']`))) throw new Error(`${sel} still visible after Esc`);
    },
  });
  return [
    open(["ctrl", "shift", "p"], "commandpalette-input", "Command Palette"),
    open(["ctrl", "p"], "quickopen-input", "Quick Open"),
    open(["ctrl", "shift", "space"], "preset-picker-input", "Preset Launcher"),
    open(["ctrl", ","], "settings-panel", "Settings"),
    open(["ctrl", "shift", "/"], "keybinding-help", "Keybinding Help"),
  ];
}

function layoutTests() {
  const sidebar = "[data-testid='sidebar-nav-kanban']";
  const auxbar = "[data-testid='auxiliary-bar']";
  return [
    {
      name: "layout: Ctrl+B hides then shows the PrimarySideBar",
      async run(d) {
        if (!(await d.displayed(sidebar))) throw new Error("sidebar not visible at baseline");
        await d.chord("ctrl", "b");
        if (!(await d.notDisplayed(sidebar))) throw new Error("sidebar still visible after Ctrl+B");
        await d.chord("ctrl", "b");
        if (!(await d.displayed(sidebar, 4000))) throw new Error("sidebar did not return after second Ctrl+B");
      },
    },
    {
      // Regression: $mod+Shift+. only fires when bound to code "Period" (Shift+. = ">").
      name: "layout: Ctrl+Shift+. hides then shows the AuxiliaryBar",
      async run(d) {
        if (!(await d.displayed(auxbar))) throw new Error("aux bar not visible at baseline");
        await d.chord("ctrl", "shift", ".");
        if (!(await d.notDisplayed(auxbar))) throw new Error("aux bar still visible after Ctrl+Shift+.");
        await d.chord("ctrl", "shift", ".");
        if (!(await d.displayed(auxbar, 4000))) throw new Error("aux bar did not return after second Ctrl+Shift+.");
      },
    },
  ];
}

function panelsTests() {
  return [
    {
      name: "mcps: Add MCP opens the dialog; Esc cancels (non-destructive)",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-mcps']");
        await d.displayed("[data-testid='mcps-panel']");
        await d.click("[data-testid='mcps-add']");
        if (!(await d.displayed("[data-testid='mcp-name']", 4000))) throw new Error("Add MCP dialog did not open");
        await d.chord("escape");
        if (!(await d.notDisplayed("[data-testid='mcp-name']"))) throw new Error("Add MCP dialog did not close on Esc");
      },
    },
    {
      name: "mcps: Refresh re-fetches without breaking the panel",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-mcps']");
        await d.click("[data-testid='mcps-refresh']");
        if (!(await d.displayed("[data-testid='mcps-panel']", 4000))) throw new Error("MCPs panel gone after refresh");
      },
    },
    {
      name: "skills: New Skill opens the editor tab; Cancel closes it",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-skills']");
        await d.displayed("[data-testid='skills-panel']");
        await d.click("[data-testid='skills-panel-new']");
        if (!(await d.displayed("[data-testid='skill-editor-panel']", 4000))) throw new Error("skill editor did not open");
        await d.click("[data-testid='skill-editor-cancel']");
        if (!(await d.notDisplayed("[data-testid='skill-editor-panel']"))) throw new Error("skill editor did not close on Cancel");
      },
    },
    {
      name: "skills: Refresh re-fetches without breaking the panel",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-skills']");
        await d.click("[data-testid='skills-panel-refresh']");
        if (!(await d.displayed("[data-testid='skills-panel']", 4000))) throw new Error("Skills panel gone after refresh");
      },
    },
  ];
}

function kanbanTests() {
  return [
    {
      name: "kanban: 'All projects' filter keeps the board rendered",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-kanban']");
        await d.displayed("[data-testid='kanban-board']");
        await d.displayed("[data-testid='project-filter-tabs']");
        await d.click("[data-testid='filter-all']");
        if (!(await d.displayed("[data-testid='kanban-board']"))) throw new Error("board gone after filter click");
      },
    },
    {
      name: "kanban: task composer captures typed input (no Send)",
      async run(d) {
        await d.click("[data-testid='sidebar-nav-kanban']");
        await d.displayed("[data-testid='composer-prompt']");
        await d.type("[data-testid='composer-prompt']", "wd smoke input");
        const val = await d.exec("return document.querySelector(\"[data-testid='composer-prompt']\").value");
        if (val !== "wd smoke input") throw new Error("composer did not capture input; got " + JSON.stringify(val));
      },
    },
  ];
}

function auxbarTests() {
  return ["files", "diff", "scm", "checks"].map((t) => ({
    name: `auxbar: clicking aux-tab-${t} selects that view`,
    async run(d) {
      await d.click(`[data-testid='aux-tab-${t}']`);
      const sel = await d.exec(
        `return document.querySelector("[data-testid='aux-tab-${t}']").getAttribute("aria-selected")`
      );
      if (sel !== "true") throw new Error(`aux-tab-${t} not selected; aria-selected=${JSON.stringify(sel)}`);
    },
  }));
}

const BATCHES = {
  nav: navTests,
  overlays: overlayTests,
  layout: layoutTests,
  panels: panelsTests,
  kanban: kanbanTests,
  auxbar: auxbarTests,
};

// ---- runner ------------------------------------------------------------

async function main() {
  const batch = process.argv[2] || "nav";
  const makeTests = BATCHES[batch];
  if (!makeTests) { console.error(`unknown batch: ${batch}; have ${Object.keys(BATCHES).join(",")}`); process.exit(2); }

  const d = new Driver();
  const results = [];
  console.log(`[harness] waiting for vite :1420 ...`);
  await d.waitForVite();
  console.log(`[harness] creating WebDriver session (launching app) ...`);
  await d.start();
  console.log(`[harness] session ${d.sid} live; waiting for app render ...`);
  try {
    // anchor: PrimarySideBar nav is always present once React mounts
    await d.waitFor("[data-testid='sidebar-nav-kanban']", 40000);
    console.log(`[harness] app rendered. running batch '${batch}' (${makeTests().length} tests)`);
    await d.shot(`${batch}-00-loaded`);

    const tests = makeTests();
    let idx = 0;
    for (const t of tests) {
      idx++;
      try {
        await t.run(d);
        results.push({ name: t.name, ok: true });
        console.log(`  PASS  ${t.name}`);
      } catch (e) {
        const shot = await d.shot(`${batch}-fail-${idx}`);
        results.push({ name: t.name, ok: false, error: e.message, shot });
        console.log(`  FAIL  ${t.name}\n        ${e.message}\n        shot: ${shot}`);
      }
    }
  } finally {
    await d.shot(`${batch}-zz-final`);
    await d.stop();
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n[harness] ${batch}: ${pass}/${results.length} passed`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => { console.error("[harness] fatal:", e.message); process.exit(3); });
