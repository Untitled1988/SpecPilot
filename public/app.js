const terminalPanes = {
  openspec: document.querySelector("#terminalOpenSpec"),
  copilot: document.querySelector("#terminalCopilot")
};
const commandForm = document.querySelector("#commandForm");
const commandInput = document.querySelector("#commandInput");
const commandPrompt = document.querySelector("#commandPrompt");
const refreshBtn = document.querySelector("#refreshBtn");
const clearBtn = document.querySelector("#clearBtn");
const terminalStatus = document.querySelector("#terminalStatus");
const terminalPanel = document.querySelector(".terminalPanel");
const terminalResizeHandle = document.querySelector("#terminalResizeHandle");
const terminalSizeButtons = document.querySelectorAll("[data-terminal-size]");
const terminalTabs = document.querySelectorAll("[data-terminal-tab]");
const terminalModeTitle = document.querySelector("#terminalModeTitle");
const terminalModeDesc = document.querySelector("#terminalModeDesc");
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
let activeTerminal = "openspec";
let activeDirectory = "";
let isResizingTerminal = false;
let resizeStartY = 0;
let resizeStartHeight = 0;

const terminalSessions = {
  openspec: {
    label: "OpenSpec",
    modeTitle: "OpenSpec 命令模式",
    modeDesc: "这里运行 openspec、npm、git 等普通命令。",
    prompt: "$",
    placeholder: "输入 openspec、npm、git 命令",
    socket: null,
    term: null,
    fitAddon: null,
    connected: false
  },
  copilot: {
    label: "Copilot",
    modeTitle: "Copilot 斜杠命令模式",
    modeDesc: "这里运行 copilot，并通过按钮发送 .github/skills 对应的斜杠命令。",
    prompt: "/",
    placeholder: "输入 /openspec-propose，或点击上方 Copilot 按钮",
    socket: null,
    term: null,
    fitAddon: null,
    connected: false,
    booted: false,
    starting: false,
    pendingCommand: "",
    outputBuffer: ""
  }
};

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

function getSession(channel = activeTerminal) {
  return terminalSessions[channel] || terminalSessions.openspec;
}

function append(text, className = "stdout", channel = activeTerminal) {
  const session = getSession(channel);
  if (session.term) {
    session.term.write(text.replace(/\n/g, "\r\n"));
    return;
  }
  const pane = terminalPanes[channel] || terminalPanes.openspec;
  pane.textContent += text;
}

function renderStatus(status) {
  renderWorkspace(status.workspace);
  const order = ["node", "npm", "openspec", "copilot"];
  renderSidebarStatus(status, order);
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
    resetTerminals();
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
  runCommand(commands[target], undefined, "openspec");
}

function getCommandChannel(command, requestedChannel) {
  if (requestedChannel === "copilot" || requestedChannel === "openspec") {
    return requestedChannel;
  }
  const normalized = String(command || "").trim();
  if (normalized.startsWith("/openspec-") || normalized === "copilot") {
    return "copilot";
  }
  return "openspec";
}

async function runCommand(command, title = command, requestedChannel) {
  if (isFileMode) {
    renderFileModeWarning();
    return;
  }
  const channel = getCommandChannel(command, requestedChannel);
  const session = getSession(channel);
  switchTerminal(channel);
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
    append(`[${stamp()}] ${session.label} 终端还没有连接好，请稍等几秒再试。\n`, "stderr", channel);
    return;
  }
  const normalized = String(command || "").trim();
  if (channel === "copilot" && normalized !== "copilot" && !session.booted) {
    session.pendingCommand = normalized;
    if (!session.starting) {
      session.starting = true;
      try {
        await sendTerminalCommand(channel, "copilot");
      } catch (err) {
        session.starting = false;
        append(`[${stamp()}] 命令发送失败：${err.message}\n`, "stderr", channel);
      }
    }
    return;
  }
  try {
    await sendTerminalCommand(channel, normalized);
  } catch (err) {
    append(`[${stamp()}] 命令发送失败：${err.message}\n`, "stderr", channel);
  }
}

async function sendTerminalCommand(channel, command) {
  if (channel === "copilot") {
    await sendTerminalInput(channel, "\u0015");
    await wait(40);
    await sendTerminalInput(channel, command);
    await wait(120);
    await sendTerminalInput(channel, "\r");
    return;
  }
  const res = await fetch("/api/terminal-command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, command })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || "命令发送失败");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTerminalInput(channel, input) {
  const res = await fetch("/api/terminal-input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel, input })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || "按键发送失败");
  }
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
    const session = getSession("openspec");
    if (session.term) {
      session.term.writeln(`已启用 ${initProfileSelect.value === "full" ? "完整" : "核心"}流程配置：${profile.workflows.join(", ")}`);
    }
    runCommand(buildInitCommand(), "初始化 OpenSpec 项目", "openspec");
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
  const selectedChannel = document.querySelector(".terminalTab.active")?.dataset.terminalTab || activeTerminal;
  runCommand(command, command, selectedChannel);
});

refreshBtn.addEventListener("click", refreshStatus);
clearBtn.addEventListener("click", () => {
  const session = getSession();
  if (session.term) {
    session.term.clear();
  } else {
    terminalPanes[activeTerminal].textContent = "";
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
terminalTabs.forEach((button) => {
  button.addEventListener("click", () => switchTerminal(button.dataset.terminalTab));
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
  if (sidebarStatus) {
    sidebarStatus.innerHTML = "";
    const tip = document.createElement("p");
    tip.className = "sideStatusEmpty";
    tip.textContent = "请改用 http://127.0.0.1:4317 访问";
    sidebarStatus.append(tip);
  }
  append(`[${stamp()}] 当前是 file:// 打开方式，请改用 http://127.0.0.1:4317。\n`, "stderr");
}

function setTerminalStatus(text, ok = false) {
  const openspec = terminalSessions.openspec.connected;
  const copilot = terminalSessions.copilot.connected;
  if (text) {
    terminalStatus.textContent = text;
  } else {
    terminalStatus.textContent = openspec && copilot
      ? "双终端已连接"
      : (openspec || copilot ? "部分连接" : "已断开");
  }
  terminalStatus.className = `terminalStatus ${ok || (openspec && copilot) ? "ok" : ""}`;
}

function resizeTerminal(channel = activeTerminal) {
  const session = getSession(channel);
  if (!session.socket || session.socket.readyState !== WebSocket.OPEN || !session.fitAddon || !session.term) return;
  try {
    session.fitAddon.fit();
  } catch {
    return;
  }
  session.socket.send(JSON.stringify({
    type: "resize",
    cols: session.term.cols,
    rows: session.term.rows
  }));
}

function resizeTerminals() {
  Object.keys(terminalSessions).forEach((channel) => resizeTerminal(channel));
}

function setTerminalHeight(height) {
  const minHeight = 160;
  const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight - 200));
  const nextHeight = Math.min(Math.max(Number(height) || terminalHeights.medium, minHeight), maxHeight);
  terminalPanel.style.setProperty("--terminal-panel-height", `${nextHeight}px`);
  localStorage.setItem("openspecTerminalHeight", String(nextHeight));
  requestAnimationFrame(resizeTerminals);
}

function restoreTerminalHeight() {
  setTerminalHeight(localStorage.getItem("openspecTerminalHeight") || terminalHeights.compact);
}

function resetTerminals() {
  Object.keys(terminalSessions).forEach((channel) => {
    const session = terminalSessions[channel];
    if (session.socket) {
      session.socket.close();
      session.socket = null;
    }
    if (session.term) {
      session.term.dispose();
      session.term = null;
    }
    session.fitAddon = null;
    session.connected = false;
    session.booted = false;
    session.starting = false;
    session.pendingCommand = "";
    session.outputBuffer = "";
    terminalPanes[channel].innerHTML = "";
  });
  setTerminalStatus("连接中");
  initTerminals();
}

function switchTerminal(channel) {
  if (!terminalSessions[channel]) return;
  activeTerminal = channel;
  document.body.dataset.activeTerminal = channel;
  terminalTabs.forEach((button) => {
    const active = button.dataset.terminalTab === channel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  Object.entries(terminalPanes).forEach(([key, pane]) => {
    pane.classList.toggle("active", key === channel);
  });
  const session = getSession(channel);
  terminalModeTitle.textContent = session.modeTitle;
  terminalModeDesc.textContent = session.modeDesc;
  commandPrompt.textContent = session.prompt;
  commandInput.placeholder = session.placeholder;
  requestAnimationFrame(resizeTerminals);
}

function createTerminal(channel) {
  if (isFileMode) return;
  if (!window.Terminal || !window.FitAddon) {
    terminalPanes[channel].textContent = "终端依赖没有加载成功。请先运行 npm install，然后重新启动服务。";
    setTerminalStatus("依赖缺失");
    return;
  }

  const session = getSession(channel);
  session.term = new Terminal({
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
  session.fitAddon = new FitAddon.FitAddon();
  session.term.loadAddon(session.fitAddon);
  session.term.open(terminalPanes[channel]);
  if (channel === activeTerminal || channel === "copilot") {
    session.fitAddon.fit();
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  session.socket = new WebSocket(`${protocol}//${location.host}/terminal?channel=${channel}`);

  session.socket.addEventListener("open", () => {
    session.connected = true;
    setTerminalStatus();
    resizeTerminal(channel);
    setTimeout(() => resizeTerminal(channel), 120);
    setTimeout(() => resizeTerminal(channel), 500);
  });

  session.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "ready") {
      session.term.writeln(`已连接到 ${message.platform} ${session.label} 终端：${message.shell}`);
      session.term.writeln(`工作目录：${message.cwd}`);
      if (channel === "copilot") {
        session.term.writeln("提示：点击上方 Copilot 操作按钮会自动进入 copilot 并发送对应斜杠命令。");
      }
      session.term.writeln("");
    }
    if (message.type === "data") {
      session.term.write(message.data);
      if (channel === "copilot") {
        updateCopilotState(message.data);
      }
    }
    if (message.type === "exit") {
      session.term.writeln(`\r\n终端已退出，退出码：${message.exitCode}`);
      session.connected = false;
      setTerminalStatus();
    }
    if (message.type === "error") {
      session.term.writeln(message.error);
      session.term.writeln(`平台：${message.platform}`);
      session.term.writeln(`Node：${message.node}`);
      session.term.writeln("建议使用 Node.js LTS 版本，并在真实系统终端中运行 npm install 后重启本应用。");
      session.connected = false;
      setTerminalStatus("启动失败");
    }
  });

  session.socket.addEventListener("close", () => {
    session.connected = false;
    setTerminalStatus();
  });

  session.socket.addEventListener("error", () => {
    session.connected = false;
    setTerminalStatus("连接失败");
  });

  session.term.onData((data) => {
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "input", data }));
    }
  });
}

function updateCopilotState(data) {
  const session = terminalSessions.copilot;
  session.outputBuffer = `${session.outputBuffer}${data}`.slice(-5000);
  const plain = session.outputBuffer.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  if (
    plain.includes("/ commands")
    || plain.includes("? help")
    || plain.includes("Session:")
    || plain.includes("AIC used")
    || plain.includes("No copilot-instructions.md")
  ) {
    session.booted = true;
    session.starting = false;
  }
  if (session.booted && session.pendingCommand) {
    const command = session.pendingCommand;
    session.pendingCommand = "";
    setTimeout(() => {
      sendTerminalCommand("copilot", command).catch((err) => {
        append(`[${stamp()}] 命令发送失败：${err.message}\n`, "stderr", "copilot");
      });
    }, 350);
  }
}

function initTerminals() {
  createTerminal("openspec");
  createTerminal("copilot");
  switchTerminal(activeTerminal);
  window.addEventListener("resize", resizeTerminals);
  setTimeout(resizeTerminals, 120);
  setTimeout(resizeTerminals, 500);
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
    const extra = btn.dataset.inputSource
      ? document.getElementById(btn.dataset.inputSource)?.value.trim()
      : "";
    const command = extra ? `${btn.dataset.command} ${extra}` : btn.dataset.command;
    runCommand(command, btn.dataset.title, btn.dataset.channel);
  });
});

document.querySelectorAll("[data-input]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const channel = btn.dataset.channel || activeTerminal;
    switchTerminal(channel);
    const input = btn.dataset.input === "enter" ? "\r" : btn.dataset.input;
    try {
      await sendTerminalInput(channel, input);
    } catch (err) {
      append(`[${stamp()}] 按键发送失败：${err.message}\n`, "stderr", channel);
    }
  });
});

append(`[${stamp()}] 欢迎使用 SpecPilot。OpenSpec 命令和 Copilot 斜杠命令现在会分别进入独立终端。\n`, "stdout", "openspec");
append(`[${stamp()}] Copilot 终端已独立准备。这里专门运行 copilot 和 OpenSpec skills 斜杠命令。\n`, "stdout", "copilot");
refreshInitPreview();
if (isFileMode) {
  renderFileModeWarning();
} else {
  restoreTerminalHeight();
  loadWorkspace();
  initTerminals();
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
