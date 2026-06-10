const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const TOOL_PATHS = ["/opt/homebrew/bin", "/usr/local/bin"];
process.env.PATH = [...TOOL_PATHS, process.env.PATH || ""].join(path.delimiter);

const clients = new Set();
let currentWorkspace = ROOT;
const CORE_WORKFLOWS = ["propose", "explore", "apply", "sync", "archive"];
const FULL_WORKFLOWS = [
  "propose",
  "explore",
  "new",
  "continue",
  "apply",
  "ff",
  "sync",
  "archive",
  "bulk-archive",
  "verify",
  "onboard"
];

const commands = {
  openspecVersion: { command: "openspec", args: ["--version"] },
  copilotVersion: { command: "copilot", args: ["--version"] },
  npmVersion: { command: "npm", args: ["--version"] },
  nodeVersion: { command: "node", args: ["--version"] }
};

function sendEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function runCheck(name, spec) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(spec.command, spec.args, {
      cwd: currentWorkspace,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let error = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        name,
        ok: false,
        version: "",
        message: "检测超时，命令未在限定时间内返回"
      });
    }, 8000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    child.on("error", (err) => {
      finish({
        name,
        ok: false,
        version: "",
        message: err.code === "ENOENT" ? "未找到命令" : err.message
      });
    });
    child.on("close", (code) => {
      const firstLine = output.trim().split("\n")[0] || "";
      const versionMatch = firstLine.match(/v?\d+\.\d+(?:\.\d+)*/);
      const versionLike = Boolean(versionMatch);
      finish({
        name,
        ok: code === 0 && versionLike,
        version: versionMatch ? versionMatch[0] : "",
        message: code === 0 && versionLike
          ? "已安装"
          : (error.trim() || (code === 0 ? "未检测到有效版本，可能尚未安装" : output.trim() || `退出码 ${code}`))
      });
    });
  });
}

async function getStatus() {
  const results = await Promise.all(
    Object.entries(commands).map(([name, spec]) => runCheck(name, spec))
  );
  const byName = Object.fromEntries(results.map((item) => [item.name, item]));
  const nodeMajor = Number((byName.nodeVersion.version || "").replace(/^v/, "").split(".")[0]);
  const nodeMinor = Number((byName.nodeVersion.version || "").replace(/^v/, "").split(".")[1]);
  const nodeOk = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 19);

  return {
    workspace: currentWorkspace,
    appRoot: ROOT,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    checkedAt: new Date().toISOString(),
    tools: {
      node: { ...byName.nodeVersion, ok: byName.nodeVersion.ok && nodeOk, minimum: ">=20.19.0" },
      npm: byName.npmVersion,
      openspec: byName.openspecVersion,
      copilot: byName.copilotVersion
    }
  };
}

function getRoots() {
  if (process.platform !== "win32") {
    return ["/", os.homedir(), ROOT];
  }
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) {
      roots.push(drive);
    }
  }
  return roots.length > 0 ? roots : [path.parse(ROOT).root];
}

function getWorkspaceInfo() {
  return {
    path: currentWorkspace,
    appRoot: ROOT,
    home: os.homedir(),
    roots: getRoots()
  };
}

function assertDirectory(dirPath) {
  const resolved = path.resolve(String(dirPath || "").trim() || currentWorkspace);
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error("选择的路径不是文件夹");
  }
  return resolved;
}

function listDirectories(dirPath) {
  const resolved = assertDirectory(dirPath || currentWorkspace);
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(resolved, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const parsed = path.parse(resolved);
  const parent = resolved === parsed.root ? "" : path.dirname(resolved);
  return {
    path: resolved,
    parent,
    home: os.homedir(),
    roots: getRoots(),
    entries
  };
}

function setWorkspace(dirPath) {
  currentWorkspace = assertDirectory(dirPath);
  const workspace = getWorkspaceInfo();
  sendEvent("workspace", workspace);
  getStatus().then((status) => sendEvent("status", status)).catch(() => {});
  return workspace;
}

function getTerminalEnv() {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor"
  };
  delete env.FORCE_COLOR;
  delete env.npm_config_color;
  return env;
}

function getOpenSpecConfigPath() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "openspec", "config.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "openspec", "config.json");
  }
  return path.join(os.homedir(), ".config", "openspec", "config.json");
}

function readOpenSpecConfig() {
  const configPath = getOpenSpecConfigPath();
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { featureFlags: {}, profile: "core", delivery: "both" };
  }
}

function writeOpenSpecProfile(profileName) {
  const configPath = getOpenSpecConfigPath();
  const config = readOpenSpecConfig();
  if (profileName === "full") {
    config.profile = "custom";
    config.delivery = config.delivery || "both";
    config.workflows = [...FULL_WORKFLOWS];
  } else {
    config.profile = "core";
    config.delivery = config.delivery || "both";
    config.workflows = [...CORE_WORKFLOWS];
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    path: configPath,
    profile: config.profile,
    workflows: config.workflows
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求太大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const vendorFiles = {
    "/vendor/xterm.css": path.join(ROOT, "node_modules", "@xterm", "xterm", "css", "xterm.css"),
    "/vendor/xterm.js": path.join(ROOT, "node_modules", "@xterm", "xterm", "lib", "xterm.js"),
    "/vendor/xterm-fit.js": path.join(ROOT, "node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")
  };
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = vendorFiles[requested] || path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR) && !Object.values(vendorFiles).includes(filePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".map": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/status") {
    json(res, 200, await getStatus());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workspace") {
    json(res, 200, getWorkspaceInfo());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/workspace") {
    const body = await readJson(req);
    json(res, 200, setWorkspace(body.path));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/directories") {
    json(res, 200, listDirectories(url.searchParams.get("path") || currentWorkspace));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/openspec/profile") {
    const body = await readJson(req);
    const profile = body.profile === "full" ? "full" : "core";
    json(res, 200, writeOpenSpecProfile(profile));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    getStatus().then((status) => sendEvent("status", status)).catch(() => {});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/install") {
    json(res, 410, { error: "请在页面终端中运行安装命令" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    json(res, 410, { error: "请使用 WebSocket 真实终端执行命令" });
    return;
  }

  json(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((err) => json(res, 500, { error: err.message }));
    return;
  }
  serveStatic(req, res);
});

function getShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe";
  }
  return process.env.SHELL || (fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");
}

function getShellArgs() {
  if (process.platform === "win32") {
    const shell = getShell().toLowerCase();
    return shell.endsWith("powershell.exe") || shell.endsWith("pwsh.exe")
      ? ["-NoLogo"]
      : [];
  }
  return ["-l"];
}

function normalizeCommand(command) {
  return String(command || "").trim();
}

const wss = new WebSocketServer({ server, path: "/terminal" });

wss.on("connection", (ws) => {
  const shell = getShell();
  const shellArgs = getShellArgs();
  let terminal;
  try {
    terminal = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: currentWorkspace,
      env: getTerminalEnv()
    });
  } catch (err) {
    ws.send(JSON.stringify({
      type: "error",
      error: `真实终端启动失败：${err.message}`,
      shell,
      platform: process.platform,
      node: process.version
    }));
    ws.close();
    return;
  }

  ws.send(JSON.stringify({
    type: "ready",
    shell,
    cwd: currentWorkspace,
    platform: process.platform
  }));

  terminal.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "data", data }));
    }
  });

  terminal.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
      ws.close();
    }
    getStatus().then((status) => sendEvent("status", status)).catch(() => {});
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "input") {
      terminal.write(String(message.data || ""));
    }

    if (message.type === "command") {
      const command = normalizeCommand(message.command);
      if (command) {
        terminal.write(`${command}${os.EOL}`);
      }
    }

    if (message.type === "resize") {
      const cols = Number(message.cols);
      const rows = Number(message.rows);
      if (cols > 0 && rows > 0) {
        terminal.resize(cols, rows);
      }
    }
  });

  ws.on("close", () => {
    if (terminal) {
      terminal.kill();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SpecPilot 规格领航已启动: http://${HOST}:${PORT}`);
  console.log(`工作目录: ${ROOT}`);
});
