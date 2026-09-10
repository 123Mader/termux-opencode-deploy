# AgentDock Android

将 [uvwt/agentdock](https://github.com/uvwt/agentdock)（Go 编写的 MCP 服务器，
v0.8.3，MCP Streamable HTTP 协议）转换打包为 Android 应用（APK）。

核心（Go）静态交叉编译为 Android arm64 ELF（arm64-v8a），由一个极简的
Kotlin 前台服务进程在手机上运行，MCP 服务固定在 `http://127.0.0.1:8765/mcp`，
可按任意 MCP 客户端（如 DeXRay_AI、Claude Desktop、通用 MCP 客户端）连接。

> 说明：`android/arm64` 纯 Go 静态交叉编译（无需 NDK）；而 `android/arm`、
> `android/amd64` 需要 cgo 外部链接，本仓暂未启用，当前仅产出 arm64-v8a APK。

## 目录结构

```
.
├── .github/workflows/agentdock-build.yml   # 一键 CI：Go 交叉编译 + Gradle 打包 APK
├── go/                                     # uvwt/agentdock v0.8.3 原始源码
└── android/
    └── app/src/main/
        ├── kotlin/com/psyche/agentdock/
        │   ├── CoreProcess.kt              # 二进制部署、进程管理、日志
        │   ├── AgentDockService.kt         # 前台服务（保活通知）
        │   └── MainActivity.kt             # 状态 / Token / 日志 UI
        ├── assets/agentdock/<abi>/agentdock # CI 构建时写入的 Go 二进制
        └── AndroidManifest.xml
```

## 如何构建

本仓库不含 Java/SDK 环境，APK 由 GitHub Actions 构建：

1. 在仓库 Actions 页选择 `agentdock-android-build` → **Run workflow**（分支 `agentdock-android`）。
2. 完成后下载 artifact `agentdock-android-apk`，得到 `app-release.apk`。

也可在本地构建：先在任意 Go 环境交叉编译二进制到
`android/app/src/main/assets/agentdock/<abi>/agentdock`，再在 `android/` 下
`gradle assembleRelease`。

## 使用

1. 安装 `app-release.apk`，打开 AgentDock，点「启动 AgentDock」。
2. 服务器运行在 `http://127.0.0.1:8765/mcp`，鉴权用界面里的 Token
   （`Authorization: Bearer <Token>`）。
3. 关闭页面后由前台服务持续运行；在通知栏可停止。
4. 工具能力受 Android 应用沙箱限制：

   - 文件/Shell 工具只能在应用私有目录（`files/AgentDock`）内读写；
   - `/system/bin` 基础命令（sh、ls、cp…）可用；
   - 浏览器自动化（chromedp）默认关闭；
   - MCP 服务仅监听本机回环地址 `127.0.0.1`，不会被局域网访问。

## 与 DeXRay_AI 集成示例

DeXRay_AI → 设置 → MCP 服务器 → 添加：

```
名称：AgentDock
地址：http://127.0.0.1:8765/mcp
协议：Streamable HTTP（POST /mcp）
鉴权：Bearer Token（AgentDock 应用内显示的 Token）
```

## 上游

- 源码：https://github.com/uvwt/agentdock
- 协议：见 `go/LICENSE`