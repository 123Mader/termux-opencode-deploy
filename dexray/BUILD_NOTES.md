# DeXRay APK 云构建排错笔记

GitHub Actions 免费 runner (14GB 磁盘) 构建 Kelivo 的踩坑记录。

## 问题与解决

| Run | 失败点 | 原因 | 解决 |
|---|---|---|---|
| #1 | 构建 APK | 磁盘不足 (No space left) | 清理平台目录 |
| #2 | 触发 422 | workflow YAML 缩进错 (with 挂错步骤) | 修 YAML |
| #3 | 构建 APK | 磁盘不足 (删了系统 SDK 不够) | 单 arm64 ABI |
| #4 | 构建 APK | 磁盘不足 | 更激进清理 |
| #5 | 构建 APK | 编译错误 (删了 lib/desktop 导致 Desktop* 组件缺失) | 保留 lib/desktop |
| #6-8 | 构建 APK | 磁盘不足 (R8 混淆中间文件爆炸) | 关 R8 (minifyEnabled=false) |
| #9 | 构建 APK | 编译错误 (find -delete 误删 sherpa 的 .dart 源码) | 只删 .so |

## 关键结论

1. **磁盘是硬瓶颈**：14GB runner 装 Flutter SDK (~4GB) + Gradle (~2GB) + 源码(40MB, so 超 100MB) 很紧张
2. **单 arm64 ABI** (`--target-platform android-arm64`) 比三 ABI 省 2/3 磁盘
3. **关 R8** (`isMinifyEnabled = false`)：避免混淆中间文件，且利于逆向分析
4. **删大 so 只删 .so**：`find . -name "*.so" -delete`，绝不动 .dart
5. **错误可见性**：构建步骤 `tee build_apk.log` + `always()` 上传 artifact，失败也能看日志
6. 编译通过 (约 8 分钟) 后失败的多是磁盘；编译期失败是代码/清理问题

## 最终 workflow 要点

- `defaults.run.working-directory: kelivo-src`
- 清理：删平台目录 + 只删大 .so + 缩 pub 缓存
- 构建：`flutter build apk --release --target-platform android-arm64`
- 产物：`DeXRay_android_<ver>_arm64-v8a.apk` → artifact `dexray-apk`
