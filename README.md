<div align="center">

# 📦 Termux + OpenCode 一键部署

**Deploy OpenCode on Android / Termux in one command**

[![Termux](https://img.shields.io/badge/Termux-v0.118.3-green.svg)](https://github.com/termux/termux-app/releases)
[![OpenCode](https://img.shields.io/badge/OpenCode-latest-orange.svg)](https://opencode.ai)
[![Install](https://img.shields.io/badge/Install-one--click-blue.svg)](install_opencode.sh)

*简体中文 | English*

</div>

---

## 🚀 这是什么

在任意 Android 手机上**一键部署 Termux + opencode（开源 AI 编程助手）**。

- ✅ 最新版 Termux APK 下载指引（universal 全架构）
- ✅ opencode 一键安装脚本（自动补装依赖、配置 PATH）
- ✅ 可选：话数据备份恢复（换机无缝迁移）
- ✅ 脚本可重复执行，安全幂等

## ⚡ 快速开始

### 1️⃣ 安装 Termux
从官方下载最新 universal APK：
**[termux/termux-app Release](https://github.com/termux/termux-app/releases)** （v0.118.3）

### 2️⃣ 初始化
```bash
termux-setup-storage
pkg update -y && pkg upgrade -y
```
pkg update && pkg install proot-distro -y

pkg install termux-auth

proot-distro install ubuntu
proot-distro login ubuntu
curl -fsSL https://opencode.ai/install | bash
opencode

### 3️⃣ 一键安装 opencode
```bash
# 方式 A：直接运行本仓库脚本
curl -fsSL https://raw.githubusercontent.com/123Mader/termux-opencode-deploy/main/install_opencode.sh | bash

# 方式 B：等价一条命令
pkg install -y curl which && curl -fsSL https://opencode.ai/install | bash
```

### 4️⃣ 验证
```bash
source ~/.bashrc
opencode --version
```

---

## 🔄 换机迁移（可选）

在新手机装好 opencode 并跑过一次后：

```bash
bash restore_opencode.sh opencode数据备份.tar.gz
```

恢复内容：全部会话历史、技能（glm-vicurl -fsSL https://opencode.ai/install | bash
opencode
sion / s4h）、配置、superpowers 插件。

## ❓ 常见问题

| 问题 | 解决 |
|---|---|
| `opencode: command not found` | 重开终端或 `source ~/.bashrc` |
| 安装报 `which` 不存在 | 脚本已自动补装 |
| 网络慢 / 失败 | 重跑即可（幂等） |

---

## 📜 版本记录

- **Termux**: v0.118.3（universal debug 签名，兼容所有 ABI）
- **OpenCode**: 始终安装最新版（截至本文 v1.18.15+）

如果这个项目对你有帮助，欢迎 ⭐ 点星支持！Issues / PR 都欢迎。

*本项目与 Termux / OpenCode 官方无关联，仅供学习与便利使用。*
