# SpecPilot 规格领航

这是一个本地运行的中文 Web App，用来管理 OpenSpec、GitHub Copilot CLI 和真实终端。

## 启动方式

macOS 在项目目录运行：

```bash
npm run dev
```

然后打开：

```text
http://127.0.0.1:4317
```

不要直接双击打开 `public/index.html`。直接打开 HTML 文件时，浏览器没有权限调用本地命令接口，所以检测、安装和终端功能都不能使用。

如果终端提示 `npm: command not found`，可以运行：

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
npm run dev
```

也可以双击 `start.command` 启动，它会自动补上常见的 Homebrew 路径。

Windows 在项目目录运行：

```powershell
npm run dev
```

也可以双击 `start.bat`，或在 PowerShell 中运行：

```powershell
.\start.ps1
```

## 已实现

- 检测 Node.js、npm、OpenSpec CLI、GitHub Copilot CLI。
- 一键安装 OpenSpec CLI：`npm install -g @fission-ai/openspec@latest`。
- 一键安装 GitHub Copilot CLI：`npm install -g @github/copilot`。
- 页面内实时显示命令启动、输出、失败和完成状态。
- 页面内置真实终端，macOS 使用系统 shell，Windows 使用系统命令解释器。
- 可以在页面中选择工作目录，OpenSpec 检测、常用按钮和真实终端都会在该目录运行。
- 常用 OpenSpec 操作按钮和自定义命令输入框。

## 真实终端说明

真实终端依赖 `node-pty`。如果页面提示真实终端启动失败，优先使用 Node.js LTS 版本，然后重新运行：

```bash
npm install
npm run dev
```
