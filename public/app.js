const toolGrid = document.querySelector("#toolGrid");
const terminal = document.querySelector("#terminal");
const commandForm = document.querySelector("#commandForm");
const commandInput = document.querySelector("#commandInput");
const refreshBtn = document.querySelector("#refreshBtn");
const clearBtn = document.querySelector("#clearBtn");
const terminalStatus = document.querySelector("#terminalStatus");
const terminalPanel = document.querySelector(".terminalPanel");
const terminalResizeHandle = document.querySelector("#terminalResizeHandle");
const terminalSizeButtons = document.querySelectorAll("[data-terminal-size]");
const workspaceInput = document.querySelector("#workspaceInput");
const workspaceHint = document.querySelector("#workspaceHint");
const chooseWorkspaceBtn = document.querySelector("#chooseWorkspaceBtn");
const applyWorkspaceBtn = document.querySelector("#applyWorkspaceBtn");
const directoryDialog = document.querySelector("#directoryDialog");
const closeDirectoryBtn = document.querySelector("#closeDirectoryBtn");
const parentDirectoryBtn = document.querySelector("#parentDirectoryBtn");
const homeDirectoryBtn = document.querySelector("#homeDirectoryBtn");
const selectDirectoryBtn = document.querySelector("#selectDirectoryBtn");
const directoryCurrent = document.querySelector("#directoryCurrent");
const directoryRoots = document.querySelector("#directoryRoots");
const directoryList = document.querySelector("#directoryList");
const runInitBtn = document.querySelector("#runInitBtn");
const initToolPicker = document.querySelector("#initToolPicker");
const initProfileSelect = document.querySelector("#initProfileSelect");
const initForceCheckbox = document.querySelector("#initForceCheckbox");
const initCommandPreview = document.querySelector("#initCommandPreview");
const sidebarStatus = document.querySelector("#sidebarStatus");
const navItems = document.querySelectorAll(".navItem");
const viewSections = document.querySelectorAll(".view");
const initShortcutBtn = document.querySelector("#initShortcutBtn");
const toggleTerminalBtn = document.querySelector("#toggleTerminalBtn");
const isFileMode = location.protocol === "file:";
let socket = null;
let term = null;
let fitAddon = null;
let activeDirectory = "";
let isResizingTerminal = false;
let resizeStartY = 0;
let resizeStartHeight = 0;

const terminalHeights = {
  compact: 240,
  medium: 360,
  large: 520
};

const toolLabels = {
  node: {
    name: "Node.js",
    desc: "OpenSpec 和 Copilot CLI 都依赖它。需要 20.19.0 或更高。",
    install: null
  },
  npm: {
    name: "npm",
    desc: "用于自动安装命令行工具。",
    install: null
  },
  openspec: {
    name: "OpenSpec CLI",
    desc: "负责初始化、查看、校验和归档 specs。",
    install: "openspec"
  },
  copilot: {
    name: "GitHub Copilot CLI",
    desc: "在终端里运行 GitHub Copilot，并使用 OpenSpec 生成的斜杠命令。",
    install: "copilot"
  }
};

function stamp() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function append(text, className = "stdout") {
  if (term) {
    term.write(text.replace(/\n/g, "\r\n"));
    return;
  }
  terminal.textContent += text;
}

function renderStatus(status) {
  renderWorkspace(status.workspace);
  const order = ["node", "npm", "openspec", "copilot"];
  renderSidebarStatus(status, order);
  toolGrid.innerHTML = "";
  for (const key of order) {
    const tool = status.tools[key];
    const meta = toolLabels[key];
    const card = document.createElement("article");
    card.className = "toolCard";

    const top = document.createElement("div");
    top.className = "toolTop";
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "toolName";
    name.textContent = meta.name;
    const desc = document.createElement("p");
    desc.textContent = meta.desc;
    const badge = document.createElement("span");
    badge.className = `badge ${tool.ok ? "ok" : "bad"}`;
    badge.textContent = tool.ok ? "正常" : "缺失";
    const version = document.createElement("code");
    version.textContent = tool.version || tool.message || "未检测到版本";

    copy.append(name, desc);
    top.append(copy, badge);
    card.append(top, version);

    if (!tool.ok && meta.install) {
      const btn = document.createElement("button");
      btn.className = "installBtn";
      btn.textContent = `自动安装 ${meta.name}`;
      btn.addEventListener("click", () => install(meta.install, btn));
      card.append(btn);
    }
    toolGrid.append(card);
  }
}

function renderSidebarStatus(status, order) {
  if (!sidebarStatus) return;
  sidebarStatus.innerHTML = "";
  for (const key of order) {
    const tool = status.tools[key];
    const meta = toolLabels[key];
    const row = document.createElement("div");
    row.className = "sideStatusItem";

    const left = document.createElement("div");
    left.className = "sideStatusName";
    const dot = document.createElement("span");
    dot.className = `dot ${tool.ok ? "ok" : "bad"}`;
    const name = document.createElement("span");
    name.textContent = meta.name;
    left.append(dot, name);

    let right;
    if (!tool.ok && meta.install) {
      right = document.createElement("button");
      right.type = "button";
      right.className = "sideStatusTag install";
      right.textContent = "安装";
      right.addEventListener("click", () => install(meta.install, right));
    } else {
      right = document.createElement("span");
      right.className = "sideStatusTag";
      right.textContent = tool.version || (tool.ok ? "正常" : "缺失");
      right.title = right.textContent;
    }

    row.append(left, right);
    sidebarStatus.append(row);
  }
}

function renderWorkspace(dirPath) {
  if (!dirPath) return;
  workspaceInput.value = dirPath;
  workspaceHint.textContent = `终端和命令会在此目录运行：${dirPath}`;
}

async function refreshStatus() {
  if (isFileMode) {
    renderFileModeWarning();
    return;
  }
  refreshBtn.disabled = true;
  try {
    const res = await fetch("/api/status");
    renderStatus(await res.json());
  } catch (err) {
    append(`[${stamp()}] 状态检测失败：${err.message}\n`, "stderr");
  } finally {
    refreshBtn.disabled = false;
  }
}

async function loadWorkspace() {
  if (isFileMode) return;
  try {
    const res = await fetch("/api/workspace");
    const workspace = await res.json();
    renderWorkspace(workspace.path);
    activeDirectory = workspace.path;
  } catch (err) {
    workspaceHint.textContent = `读取工作目录失败：${err.message}`;
  }
}

async function applyWorkspace(dirPath) {
  const target = String(dirPath || workspaceInput.value || "").trim();
  if (!target) {
    workspaceHint.textContent = "请输入或选择一个文件夹路径。";
    return;
  }
  applyWorkspaceBtn.disabled = true;
  try {
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target })
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "切换失败");
    }
    renderWorkspace(body.path);
    activeDirectory = body.path;
    resetTerminal();
    refreshStatus();
  } catch (err) {
    workspaceHint.textContent = `切换失败：${err.message}`;
  } finally {
    applyWorkspaceBtn.disabled = false;
  }
}

async function install(target, btn) {
  if (isFileMode) {
    renderFileModeWarning();
    return;
  }
  const commands = {
    openspec: "npm install -g @fission-ai/openspec@latest",
    copilot: "npm install -g @github/copilot"
  };
  runCommand(commands[target]);
}

async function runCommand(command, title = command) {
  if (isFileMode) {
    renderFileModeWarning();
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    append(`[${stamp()}] 终端还没有连接好，请稍等几秒再试。\n`, "stderr");
    return;
  }
  socket.send(JSON.stringify({ type: "command", command: title ? command : command }));
}

function getSelectedInitTools() {
  return [...initToolPicker.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value);
}

function buildInitCommand() {
  const tools = getSelectedInitTools();
  const toolArg = tools.length > 0 ? tools.join(",") : "none";
  const profile = initProfileSelect.value === "full" ? "custom" : "core";
  const parts = ["openspec", "init", "--tools", toolArg];
  if (profile) {
    parts.push("--profile", profile);
  }
  if (initForceCheckbox.checked) {
    parts.push("--force");
  }
  return parts.join(" ");
}

function refreshInitPreview() {
  if (initProfileSelect.value === "full") {
    initCommandPreview.textContent = `先启用完整流程配置，然后执行：${buildInitCommand()}`;
    return;
  }
  initCommandPreview.textContent = buildInitCommand();
}

async function applyOpenSpecProfile() {
  const profile = initProfileSelect.value === "full" ? "full" : "core";
  const res = await fetch("/api/openspec/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || "写入 OpenSpec 配置失败");
  }
  return body;
}

async function runInitCommand() {
  const selectedTools = getSelectedInitTools();
  if (selectedTools.length === 0 && !confirm("你没有选择任何 AI 工具，将只初始化 OpenSpec 基础目录。继续吗？")) {
    return;
  }
  runInitBtn.disabled = true;
  try {
    const profile = await applyOpenSpecProfile();
    if (term) {
      term.writeln(`已启用 ${initProfileSelect.value === "full" ? "完整" : "核心"}流程配置：${profile.workflows.join(", ")}`);
    }
    runCommand(buildInitCommand(), "初始化 OpenSpec 项目");
  } catch (err) {
    append(`[${stamp()}] 初始化配置失败：${err.message}\n`, "stderr");
  } finally {
    runInitBtn.disabled = false;
  }
}

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  commandInput.value = "";
  runCommand(command);
});

refreshBtn.addEventListener("click", refreshStatus);
clearBtn.addEventListener("click", () => {
  if (term) {
    term.clear();
  } else {
    terminal.textContent = "";
  }
});

chooseWorkspaceBtn.addEventListener("click", () => openDirectory());
applyWorkspaceBtn.addEventListener("click", () => applyWorkspace());
workspaceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    applyWorkspace();
  }
});
closeDirectoryBtn.addEventListener("click", () => directoryDialog.close());
parentDirectoryBtn.addEventListener("click", () => {
  if (parentDirectoryBtn.dataset.path) {
    openDirectory(parentDirectoryBtn.dataset.path);
  }
});
homeDirectoryBtn.addEventListener("click", () => openDirectory(homeDirectoryBtn.dataset.path));
selectDirectoryBtn.addEventListener("click", () => {
  workspaceInput.value = activeDirectory;
  directoryDialog.close();
  applyWorkspace(activeDirectory);
});
runInitBtn.addEventListener("click", runInitCommand);
initToolPicker.addEventListener("change", refreshInitPreview);
initProfileSelect.addEventListener("change", refreshInitPreview);
initForceCheckbox.addEventListener("change", refreshInitPreview);

function setActiveNav(viewId) {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewId);
  });
}

navItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    const target = document.getElementById(item.dataset.view);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActiveNav(item.dataset.view);
  });
});

const contentScroll = document.querySelector(".content");
if (contentScroll && "IntersectionObserver" in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) {
        setActiveNav(visible.target.id);
      }
    },
    { root: contentScroll, rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.5, 1] }
  );
  viewSections.forEach((section) => spy.observe(section));
}

if (initShortcutBtn) {
  initShortcutBtn.addEventListener("click", () => {
    const target = document.getElementById("view-dashboard");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActiveNav("view-dashboard");
    runInitBtn.focus();
  });
}
terminalSizeButtons.forEach((button) => {
  button.addEventListener("click", () => setTerminalHeight(terminalHeights[button.dataset.terminalSize]));
});
terminalResizeHandle.addEventListener("pointerdown", (event) => {
  isResizingTerminal = true;
  resizeStartY = event.clientY;
  resizeStartHeight = terminalPanel.getBoundingClientRect().height;
  terminalResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("resizingTerminal");
});
terminalResizeHandle.addEventListener("pointermove", (event) => {
  if (!isResizingTerminal) return;
  setTerminalHeight(resizeStartHeight - (event.clientY - resizeStartY));
});
terminalResizeHandle.addEventListener("pointerup", (event) => {
  isResizingTerminal = false;
  terminalResizeHandle.releasePointerCapture(event.pointerId);
  document.body.classList.remove("resizingTerminal");
});

if (toggleTerminalBtn) {
  toggleTerminalBtn.addEventListener("click", () => {
    const collapsed = terminalPanel.classList.toggle("collapsed");
    toggleTerminalBtn.setAttribute("aria-expanded", String(!collapsed));
    toggleTerminalBtn.title = collapsed ? "展开终端" : "收起终端";
    toggleTerminalBtn.querySelector(".material-symbols-outlined").textContent = collapsed
      ? "keyboard_arrow_up"
      : "keyboard_arrow_down";
    if (!collapsed) {
      requestAnimationFrame(resizeTerminal);
    }
  });
}

function renderFileModeWarning() {
  toolGrid.innerHTML = "";
  const card = document.createElement("article");
  card.className = "toolCard";
  const title = document.createElement("div");
  title.className = "toolName";
  title.textContent = "需要先启动本地服务";
  const desc = document.createElement("p");
  desc.textContent = "当前是直接打开 HTML 文件，浏览器不能调用本机命令接口。请在项目目录运行 npm run dev，然后访问 http://127.0.0.1:4317。";
  card.append(title, desc);
  toolGrid.append(card);
  append(`[${stamp()}] 当前是 file:// 打开方式，请改用 http://127.0.0.1:4317。\n`, "stderr");
}

function setTerminalStatus(text, ok = false) {
  terminalStatus.textContent = text;
  terminalStatus.className = `terminalStatus ${ok ? "ok" : ""}`;
}

function resizeTerminal() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !fitAddon || !term) return;
  fitAddon.fit();
  socket.send(JSON.stringify({
    type: "resize",
    cols: term.cols,
    rows: term.rows
  }));
}

function setTerminalHeight(height) {
  const minHeight = 160;
  const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight - 200));
  const nextHeight = Math.min(Math.max(Number(height) || terminalHeights.medium, minHeight), maxHeight);
  terminalPanel.style.setProperty("--terminal-panel-height", `${nextHeight}px`);
  localStorage.setItem("openspecTerminalHeight", String(nextHeight));
  requestAnimationFrame(resizeTerminal);
}

function restoreTerminalHeight() {
  setTerminalHeight(localStorage.getItem("openspecTerminalHeight") || terminalHeights.compact);
}

function resetTerminal() {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (term) {
    term.dispose();
    term = null;
  }
  terminal.innerHTML = "";
  setTerminalStatus("连接中");
  initTerminal();
}

function initTerminal() {
  if (isFileMode) return;
  if (!window.Terminal || !window.FitAddon) {
    terminal.textContent = "终端依赖没有加载成功。请先运行 npm install，然后重新启动服务。";
    setTerminalStatus("依赖缺失");
    return;
  }

  term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.35,
    theme: {
      background: "#ffffff",
      foreground: "#0b1c30",
      cursor: "#4648d4",
      selectionBackground: "#dbe2ff"
    }
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminal);
  fitAddon.fit();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/terminal`);

  socket.addEventListener("open", () => {
    setTerminalStatus("已连接", true);
    resizeTerminal();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "ready") {
      term.writeln(`已连接到 ${message.platform} 终端：${message.shell}`);
      term.writeln(`工作目录：${message.cwd}`);
      term.writeln("");
    }
    if (message.type === "data") {
      term.write(message.data);
    }
    if (message.type === "exit") {
      term.writeln(`\r\n终端已退出，退出码：${message.exitCode}`);
      setTerminalStatus("已断开");
    }
    if (message.type === "error") {
      term.writeln(message.error);
      term.writeln(`平台：${message.platform}`);
      term.writeln(`Node：${message.node}`);
      term.writeln("建议使用 Node.js LTS 版本，并在真实系统终端中运行 npm install 后重启本应用。");
      setTerminalStatus("启动失败");
    }
  });

  socket.addEventListener("close", () => {
    setTerminalStatus("已断开");
  });

  socket.addEventListener("error", () => {
    setTerminalStatus("连接失败");
  });

  term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  window.addEventListener("resize", resizeTerminal);
}

async function openDirectory(pathToOpen = workspaceInput.value) {
  if (isFileMode) {
    renderFileModeWarning();
    return;
  }
  try {
    const url = new URL("/api/directories", location.origin);
    if (pathToOpen) {
      url.searchParams.set("path", pathToOpen);
    }
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "无法读取目录");
    }
    activeDirectory = body.path;
    directoryCurrent.textContent = body.path;
    parentDirectoryBtn.disabled = !body.parent;
    parentDirectoryBtn.dataset.path = body.parent || "";
    homeDirectoryBtn.dataset.path = body.home;
    renderDirectoryRoots(body.roots);
    renderDirectoryList(body.entries);
    if (!directoryDialog.open) {
      directoryDialog.showModal();
    }
  } catch (err) {
    workspaceHint.textContent = `打开目录失败：${err.message}`;
  }
}

function renderDirectoryRoots(roots) {
  directoryRoots.innerHTML = "";
  roots.forEach((root) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = root;
    btn.addEventListener("click", () => openDirectory(root));
    directoryRoots.append(btn);
  });
}

function renderDirectoryList(entries) {
  directoryList.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "emptyDirectory";
    empty.textContent = "这个目录下面没有可进入的文件夹。";
    directoryList.append(empty);
    return;
  }
  entries.forEach((entry) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = entry.name;
    btn.addEventListener("click", () => openDirectory(entry.path));
    directoryList.append(btn);
  });
}

document.querySelectorAll("[data-command]").forEach((btn) => {
  btn.addEventListener("click", () => {
    runCommand(btn.dataset.command, btn.dataset.title);
  });
});

append(`[${stamp()}] 欢迎使用 OpenSpec 本地管理器。先看左侧环境检查，所有命令输出都会显示在这里。\n`);
refreshInitPreview();
if (isFileMode) {
  renderFileModeWarning();
} else {
  restoreTerminalHeight();
  loadWorkspace();
  initTerminal();
  const events = new EventSource("/api/events");
  events.addEventListener("status", (event) => renderStatus(JSON.parse(event.data)));
  events.addEventListener("workspace", (event) => {
    const workspace = JSON.parse(event.data);
    renderWorkspace(workspace.path);
  });
  events.addEventListener("run-start", (event) => {
    const run = JSON.parse(event.data);
    append(`[${stamp()}] 开始：${run.title}\n`);
  });
  events.addEventListener("run-output", (event) => {
    const output = JSON.parse(event.data);
    append(output.text, output.stream);
  });
  events.addEventListener("run-end", (event) => {
    const run = JSON.parse(event.data);
    const ok = run.status === "success";
    append(`\n[${stamp()}] ${ok ? "完成" : "失败"}：${run.title}，退出码 ${run.exitCode ?? "无"}\n`, ok ? "stdout" : "stderr");
  });
  events.onerror = () => {
    append(`[${stamp()}] 实时连接断开，浏览器会自动重连。\n`, "stderr");
  };
  refreshStatus();
}
