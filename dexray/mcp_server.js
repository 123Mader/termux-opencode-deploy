#!/usr/bin/env node
// DeXRay AI — MCP 服务器 (streamable HTTP)
//
// 实现 MCP (Model Context Protocol) streamable HTTP 传输, 协议版本 2025-11-25。
// 零依赖纯 Node。Kelivo (mcp_client 2.0.0) 通过 http://127.0.0.1:PORT/mcp 连接。
//
// 工具 (第一期 · 分析引擎):
//   apk_info      APK 结构/清单/权限/组件 分析
//   apk_strings   dex 字符串提取 (URL/密钥线索)
//   apk_pack      脱壳/打包判断
//   apk_review    AI 自然语言解读 (智谱 GLM)
//   apk_extract   解包 + 文件树
//
// 用法: node mcp_server.js [端口=8791]

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.DEXRAY_PORT || 8791);
const RE_DIR = process.env.DSH_RE_DIR || '/storage/emulated/0/MT2/apks/re';
const RUN_APK = path.join(RE_DIR, 'run_apk.js');
// Android 上 argv[0] 可能是 linker64, 用已知 node 路径
const NODE_CANDIDATES = [process.argv[0], process.execPath, '/data/data/com.dsharnessmobile.shell/files/usr/bin/node', 'node'];
const NODE = NODE_CANDIDATES.find(c => c && /node$/.test(c) && fs.existsSync(c)) || 'node';
const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'dexray-ai';
const SERVER_VERSION = '0.1.0';

// ---------- 工具定义 (MCP schema) ----------
const TOOLS = [
  {
    name: 'apk_info',
    description: '分析 APK: 包名/版本/组件(activity,service,receiver,provider)/权限清单/文件结构。输入本地 apk 路径。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' }
      },
      required: ['apkPath']
    }
  },
  {
    name: 'apk_strings',
    description: '提取 APK 中 classes.dex 的字符串, 找出 URL/域名/key/token 等关键线索。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' },
        keyword: { type: 'string', description: '可选: 只返回含该关键词的字符串' }
      },
      required: ['apkPath']
    }
  },
  {
    name: 'apk_pack',
    description: '判断 APK 是否加壳/加固 (360/爱加密/梆梆等), 是否为 Flutter 应用。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' }
      },
      required: ['apkPath']
    }
  },
  {
    name: 'apk_review',
    description: 'AI 解读: 对 APK 分析结果生成自然语言安全/逆向报告 (调用智谱 GLM)。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' }
      },
      required: ['apkPath']
    }
  },
  {
    name: 'dex_classes',
    description: '解析 APK 的 classes.dex: 列出类/方法/字段签名 (smali 级骨架)。输入 apk 路径。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' },
        className: { type: 'string', description: '可选: 只显示类名包含该关键词的类' },
        maxClasses: { type: 'number', description: '可选: 最多类数 (默认 30)' }
      },
      required: ['apkPath']
    }
  },
  {
    name: 'apk_extract',
    description: '列出 APK 内部完整文件树 (zip 条目), 可按顶层目录过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        apkPath: { type: 'string', description: 'APK 文件路径' },
        filter: { type: 'string', description: '可选: 只显示路径包含该关键词的条目' }
      },
      required: ['apkPath']
    }
  }
];

// ---------- 工具执行 ----------
function runAnalyzer(apkPath, options = {}) {
  return new Promise((resolveP) => {
    if (!fs.existsSync(apkPath)) {
      return resolveP({ ok: false, error: `APK 文件不存在: ${apkPath}` });
    }
    if (!fs.existsSync(RUN_APK)) {
      return resolveP({ ok: false, error: `分析引擎缺失: ${RUN_APK} (设置 DSH_RE_DIR)` });
    }
    const tmpJson = path.join(RE_DIR, `.dexray_${Date.now()}.json`);
    const args = [RUN_APK, apkPath, tmpJson];
    if (options.ai) args.push('--ai');
    execFile(NODE, args, { timeout: 120000, maxBuffer: 32 * 1024 * 1024 }, (err) => {
      let data = null;
      if (fs.existsSync(tmpJson)) {
        try { data = JSON.parse(fs.readFileSync(tmpJson, 'utf8')); } catch { /* ignore */ }
        fs.rmSync(tmpJson, { force: true });
      }
      if (err && !data) return resolveP({ ok: false, error: err.message });
      if (!data) return resolveP({ ok: false, error: '分析引擎无输出' });
      resolveP({ ok: true, data });
    });
  });
}

// 各工具的专用处理
async function handleTool(name, args) {
  const apkPath = args.apkPath;
  switch (name) {
    case 'apk_info': {
      const r = await runAnalyzer(apkPath);
      if (!r.ok) return { content: [{ type: 'text', text: '❌ ' + r.error }] };
      const m = r.data.manifest || {};
      const lines = [
        `# APK 分析: ${r.data.apk}`,
        `包名: ${m.package}  版本: ${m.versionName} (${m.versionCode})`,
        `大小: ${r.data.sizeMB}MB  条目: ${r.data.entries}  解压: ${r.data.uncompressedMB}MB`,
        `组件: activity=${m.activities} service=${m.services} receiver=${m.receivers} provider=${m.providers}`,
        `权限 (${m.permissionCount}): ${(m.permissions || []).join(', ') || '无'}`
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    case 'apk_strings': {
      const r = await runAnalyzer(apkPath);
      if (!r.ok) return { content: [{ type: 'text', text: '❌ ' + r.error }] };
      let strs = (r.data.dex?.interestingStrings || []);
      if (args.keyword) strs = strs.filter(s => s.includes(args.keyword));
      const text = strs.length
        ? `找到 ${strs.length} 条线索 (dex 共 ${r.data.dex?.stringCount} 字符串):\n` + strs.slice(0, 50).map(s => '  • ' + s).join('\n')
        : `无匹配 (dex 共 ${r.data.dex?.stringCount} 字符串, 试试 apk_extract 看结构)`;
      return { content: [{ type: 'text', text: text }] };
    }
    case 'apk_pack': {
      const r = await runAnalyzer(apkPath);
      if (!r.ok) return { content: [{ type: 'text', text: '❌ ' + r.error }] };
      const p = r.data.packing || {};
      const lines = [
        `# 打包/脱壳判断`,
        p.note || '未知',
        p.packingMarkers?.length ? `加固特征: ${p.packingMarkers.join(', ')}` : '未发现常见加固',
        `有效 dex 数: ${p.validDexCount}   Flutter: ${p.isFlutter}`
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    case 'apk_review': {
      const r = await runAnalyzer(apkPath, { ai: true });
      if (!r.ok) return { content: [{ type: 'text', text: '❌ ' + r.error }] };
      return { content: [{ type: 'text', text: '## AI 解读\n\n' + (r.data.aiReview || '无解读结果') }] };
    }
    case 'dex_classes': {
      // 解析 classes.dex: 提取 → 解析 → 列类/方法/字段
      try {
        const { execFileSync } = require('child_process');
        const tmpDex = path.join(RE_DIR, '.dexray_dex_' + Date.now() + '.dex');
        // 用 zip_inspect 提取第一个 classes*.dex
        execFileSync(NODE, [path.join(RE_DIR, 'zip_inspect.js'), apkPath, '--extract', 'classes.dex', tmpDex], { timeout: 30000 });
        const { parseDex } = require('./dex_parser');
        const dex = parseDex(fs.readFileSync(tmpDex));
        fs.rmSync(tmpDex, { force: true });
        let classes = dex.classes;
        if (args.className) classes = classes.filter(c => c.name.includes(args.className));
        const max = Math.min(args.maxClasses || 30, 80);
        const lines = [
          `DEX: 类=${dex.stats.classes} 方法=${dex.stats.methods} 字段=${dex.stats.fields} 字符串=${dex.stats.strings}`,
          `匹配类: ${classes.length}${args.className ? ` (过滤 "${args.className}")` : ''}`
        ];
        for (const c of classes.slice(0, max)) {
          lines.push(`${c.access} class ${c.name}${c.superclass ? ' extends ' + c.superclass : ''}`);
          for (const m of c.methods.slice(0, 5)) {
            lines.push(`  ${m.access} ${m.returnType} ${m.name}(${m.params.join(', ')})${m.hasCode ? '' : ' [abstract/native]'}`);
          }
          if (c.methods.length > 5) lines.push(`  ... (共 ${c.methods.length} 方法)`);
        }
        if (classes.length > max) lines.push(`... 共 ${classes.length} 个类, 用 className 过滤`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (e) {
        return { content: [{ type: 'text', text: '❌ ' + e.message }] };
      }
    }
    case 'apk_extract': {
      // 直接解析 zip 列出条目 (轻量, 不跑完整分析)
      try {
        const buf = fs.readFileSync(apkPath);
        const entries = parseZip(buf);
        let list = entries.map(e => e.name);
        if (args.filter) list = list.filter(n => n.includes(args.filter));
        const text = `共 ${entries.length} 条目${args.filter ? ` (过滤 "${args.filter}" → ${list.length})` : ''}:\n` +
          list.slice(0, 60).map(n => '  ' + n).join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (e) {
        return { content: [{ type: 'text', text: '❌ ' + e.message }] };
      }
    }
    default:
      return { content: [{ type: 'text', text: '未知工具: ' + name }] };
  }
}

// 轻量 zip 条目解析 (仅文件名, 供 apk_extract)
function parseZip(buf) {
  const entries = [];
  let eocd = -1;
  for (let off = buf.length - 22; off >= Math.max(0, buf.length - 65557); off--) {
    if (buf.readUInt32LE(off) === 0x06054b50) { eocd = off; break; }
  }
  if (eocd < 0) throw new Error('非有效 zip/apk');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  let off = cdOff;
  const end = cdOff + cdSize;
  while (off < end && entries.length < total) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- MCP streamable HTTP 服务器 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET') {
    // 健康检查
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, tools: TOOLS.map(t => t.name) }));
    }
    res.writeHead(404); return res.end('not found');
  }
  if (req.method !== 'POST' || url.pathname !== '/mcp') {
    res.writeHead(404); return res.end('use POST /mcp');
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }

    // SSE 响应头 (streamable HTTP 规范)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'mcp-session-id': `dexray-${Date.now()}`
    });

    const send = (payload) => {
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const method = msg.method;
      if (method === 'initialize') {
        send({
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
          }
        });
      } else if (method === 'notifications/initialized') {
        // 无响应
      } else if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      } else if (method === 'tools/call') {
        const { name, arguments: args = {} } = msg.params;
        try {
          const result = await handleTool(name, args);
          send({ jsonrpc: '2.0', id: msg.id, result });
        } catch (e) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
        }
      } else if (method === 'ping') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
      } else if (method === 'tools/list_changed') {
        // notification
      } else {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `未知方法 ${method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
    }
    // 延迟关闭让 SSE 刷出
    setTimeout(() => res.end(), 100);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🛰️  DeXRay AI MCP 服务器已启动`);
  console.log(`    端点: http://127.0.0.1:${PORT}/mcp`);
  console.log(`    协议: MCP ${PROTOCOL_VERSION} (streamable HTTP)`);
  console.log(`    工具: ${TOOLS.map(t => t.name).join(', ')}`);
  console.log(`    引擎: ${RUN_APK}`);
  console.log(`    健康: http://127.0.0.1:${PORT}/health\n`);
});
