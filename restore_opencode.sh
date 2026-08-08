#!/data/data/com.termux/files/usr/bin/bash
# opencode 数据恢复脚本（2026-08-09 生成）
# 用法：先装好 Termux + opencode 并跑过一次，然后：
#   bash restore_opencode.sh [备份包路径]
set -e

ARCHIVE="${1:-$(dirname "$0")/opencode数据备份.tar.gz}"
[ -f "$ARCHIVE" ] || { echo "找不到备份包: $ARCHIVE"; exit 1; }

echo "==> [1/3] 关闭可能占用数据库的 opencode 进程"
pkill -f opencode 2>/dev/null || true
sleep 1

echo "==> [2/3] 解压到 home（share/config/plugins 三个目录）"
tar xzf "$ARCHIVE" -C "$HOME"

echo "==> [3/3] 放到正式位置（旧数据先挪到 .old 保留）"
if [ -d "$HOME/.local/share/opencode" ]; then mv "$HOME/.local/share/opencode" "$HOME/.local/share/opencode.old"; fi
mv "$HOME/share" "$HOME/.local/share/opencode"

if [ -d "$HOME/.config/opencode" ] && [ ! -L "$HOME/.config/opencode" ]; then
  mv "$HOME/.config/opencode" "$HOME/.config/opencode.old"
fi
mv "$HOME/config" "$HOME/.config/opencode"

if [ -d "$HOME/.opencode" ] && [ ! -L "$HOME/.opencode" ] && [ -f "$HOME/.opencode/opencode.json" ]; then
  mv "$HOME/.opencode" "$HOME/.opencode.old"
fi
cp -r "$HOME/plugins" "$HOME/.opencode"

echo ""
echo "恢复完成！重新打开 opencode 即可看到原会话记录、技能与插件。"
echo "（确认无误后可删除 .old 目录）"