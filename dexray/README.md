# DeXRay AI — APK 逆向工作台 (MCP 服务器)

Kelivo 二次开发的 AI 逆向工作台。将 APK 分析/修改能力封装为 **MCP 服务器**，
Kelivo (或其他 MCP 客户端) 通过 HTTP 连接即可让 AI 对话直接分析/修改 APK。

## 架构

```
Kelivo App ──MCP(HTTP)──▶ DeXRay MCP 服务器 (Node, 端口 8791)
                              │
     第一期 · 分析引擎         │
       ├─ apk_info      APK 结构/清单/权限/组件
       ├─ apk_strings   dex 字符串线索
       ├─ apk_pack      脱壳/打包判断
       ├─ apk_review    AI 自然语言解读 (智谱 GLM)
       ├─ apk_extract   文件树
       └─ dex_classes   DEX 类/方法/字段解析 (smali 骨架)
     第二期 · 修改引擎 (独立脚本)
       ├─ apk_tool.js   解包/重打包/替换条目
       └─ sign_apk.js   v1 JAR 签名 (纯 Node RSA, debug)
```

## 启动

```sh
node /storage/emulated/0/MT2/apks/dexray/mcp_server.js [端口=8791]
# 或
sh /storage/emulated/0/MT2/apks/dexray/dexray.sh start|stop|status|restart
```

- 端点: `http://127.0.0.1:8791/mcp`
- 健康: `http://127.0.0.1:8791/health`
- 协议: MCP streamable HTTP, 版本 2025-11-25
- 零依赖 (纯 Node)

## MCP 工具

| 工具 | 说明 | 参数 |
|---|---|---|
| `apk_info` | 包名/版本/组件/权限/结构 | apkPath |
| `apk_strings` | dex 字符串 + URL/密钥线索 | apkPath, keyword? |
| `apk_pack` | 脱壳判断 (360/爱加密/Flutter) | apkPath |
| `apk_review` | AI 解读报告 (智谱 GLM) | apkPath |
| `apk_extract` | zip 文件树 | apkPath, filter? |
| `dex_classes` | 类/方法/字段签名 (smali 骨架) | apkPath, className?, maxClasses? |

## 第二期 · 修改引擎 (独立脚本)

```sh
node dex_parser.js classes.dex          # 类/方法/字段清单 (实测 6112 类)
node dex_parser.js classes.dex --json   # 结构化 JSON
node apk_tool.js unpack app.apk dir     # 解包
node apk_tool.js repack dir app2.apk    # 重打包 (zip 完整实现)
node apk_tool.js replace app.apk META-INF/MANIFEST.MF new.mf out.apk  # 替换条目
node sign_apk.js app.apk signed.apk     # v1 JAR 签名 (debug 自签)
```

**关于重签名**：纯 Node 的 `sign_apk.js` 实现了 v1 JAR 签名结构
(MANIFEST.MF + CERT.SF + RSA 签名)，供离线/学习验证；**正式安装请用官方
apksigner** (云构建 GitHub Actions 环境自带，一条命令)。

## 连接 Kelivo

Kelivo 已内置 DeXRay 注册 (`lib/core/providers/mcp_provider.dart` 的
`_builtinDexrayServerIfMissing`)，启动即自动连接 `http://127.0.0.1:8791/mcp`。

## 测试

```sh
# 健康检查
curl http://127.0.0.1:8791/health

# MCP 工具调用
curl -X POST http://127.0.0.1:8791/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"apk_info","arguments":{"apkPath":"/path/to.apk"}}}'
```

## 路线图

- [x] 第一期: 分析引擎 (info/strings/pack/review/extract/dex_classes)
- [x] 第二期: 修改引擎 (dex 解析 / 解包 / 重打包 / v1 签名)
- [ ] 第三期: 深度引擎 (SO/ELF 分析, Flutter AOT, v2 签名)

## 许可

基于 Kelivo (AGPL-3.0) 二次开发。仅供学习研究，请仅处理你拥有或已获授权的 APK。
