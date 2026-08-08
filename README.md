# 新手机安装 Termux + opencode（2026-08-09 备份）

## 所需文件（本目录内）
| 文件 | 用途 |
|---|---|
| `termux-app_v0.118.3+github-debug_universal.apk` | Termux 最新版 v0.118.3（universal，全架构通用，112MB） |
| `install_opencode.sh` | opencode 一键安装脚本 |
| `opencode数据备份.tar.gz` | opencode 数据备份（会话数据库/技能/配置/插件，41MB） |
| `restore_opencode.sh` | 数据恢复脚本 |

## 步骤

### 1. 安装 Termux
把 `termux-app_v0.118.3+github-debug_universal.apk` 传到新手机，直接安装。
> 官方来源：GitHub `termux/termux-app` Releases v0.118.3
> 若提示"未知来源"，允许安装即可。

### 2. 初始化 Termux（首次必须）
打开 Termux 终端，先跑：
```bash
termux-setup-storage
pkg update -y && pkg upgrade -y
```

### 3. 一键安装 opencode
把 `install_opencode.sh` 传到手机（可用 `cp` 复制到 `~/` 或存储里通过 termux-setup-storage 访问）：
```bash
# 方法 A：若脚本已传到手机存储
cp /storage/emulated/0/MT2/新手机安装包/install_opencode.sh ~/
bash install_opencode.sh

# 方法 B：联网设备直接一条命令（等价）
pkg install -y curl which && curl -fsSL https://opencode.ai/install | bash
```

### 4.（可选）恢复 opencode 数据
先手动打开 opencode 一次（让它建好目录），退出后执行：
```bash
cp /storage/emulated/0/MT2/新手机安装包/restore_opencode.sh \
   /storage/emulated/0/MT2/新手机安装包/opencode数据备份.tar.gz ~/
cd ~ && bash restore_opencode.sh
```
恢复内容：全部会话记录（数据库）、glm-vision/s4h 等技能、配置、superpowers 插件。

### 4. 验证
```bash
source ~/.bashrc
opencode --version   # 应显示 1.18.15 或更高
```

## 常见问题
- **Termux 提示 bash: opencode: command not found** → 关掉终端重开，或 `source ~/.bashrc`
- **安装脚本报 which 不存在** → 已按上面 [1/4] 步骤自动补装
- **网络慢/失败** → 重跑一次即可（脚本可重复执行）

## 版本记录
- Termux: v0.118.3（2025-07 GitHub Release，universal debug 签名，兼容所有 ABI）
- opencode: 脚本始终拉取最新版（本机当前 v1.18.15）