#!/data/data/com.termux/files/usr/bin/bash
# opencode 一键安装（Termux 专用，2026-08-09 生成）
# 用法：termux 里执行  bash install_opencode.sh
set -e

echo "==> [1/4] 更新 Termux 软件源并安装依赖 (curl/which)"
pkg update -y
pkg install -y curl which

echo "==> [2/4] 下载并安装 opencode 最新版"
curl -fsSL https://opencode.ai/install | bash

echo "==> [3/4] 配置 PATH"
if ! grep -q '.opencode/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.opencode/bin:$PATH"' >> "$HOME/.bashrc"
fi
export PATH="$HOME/.opencode/bin:$PATH"

echo "==> [4/4] 验证"
opencode --version

echo ""
echo "安装完成！请关掉 Termux 窗口重新打开，或执行:"
echo "    source ~/.bashrc"
echo "然后输入 opencode 即可开始使用"