#!/usr/bin/env node
// DeXRay AI 第二期 · APK 解包/重打包工具 (纯 Node, 零依赖)
//
// 能力:
//   unpack  解包 APK → 目录 (还原所有条目)
//   repack  目录 → APK (重新打包 zip)
//   replace 替换/新增单个条目 (解包→改→重打包的便捷封装)
//
// 用法:
//   node apk_tool.js unpack <apk> <目录>
//   node apk_tool.js repack <目录> <apk>
//   node apk_tool.js replace <apk> <内部路径> <新文件> <输出apk>
//
// 注意: 重打包后需重签名才能安装 (见 sign_apk.js)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

// ---------- zip 读取 ----------
function readEocd(buf) {
  for (let off = buf.length - 22; off >= Math.max(0, buf.length - 65557); off--) {
    if (buf.readUInt32LE(off) === 0x06054b50) {
      return {
        totalEntries: buf.readUInt16LE(off + 10),
        cdSize: buf.readUInt32LE(off + 12),
        cdOffset: buf.readUInt32LE(off + 16)
      };
    }
  }
  throw new Error('非有效 zip/apk');
}

function readEntries(buf, cd) {
  const entries = [];
  let off = cd.cdOffset;
  const end = cd.cdOffset + cd.cdSize;
  while (off < end && entries.length < cd.totalEntries) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = u16(buf, off + 10);
    const compSize = u32(buf, off + 20);
    const uncompSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOff = u32(buf, off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const localOff = entry.localOff;
  if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('本地头损坏: ' + entry.name);
  const nameLen = u16(buf, localOff + 26);
  const extraLen = u16(buf, localOff + 28);
  const dataOff = localOff + 30 + nameLen + extraLen;
  const data = buf.subarray(dataOff, dataOff + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('不支持的压缩: ' + entry.method);
}

// ---------- zip 写入 (零依赖 deflate) ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function buildZip(files) {
  // files: [{name, data(Buffer), method?}]
  const chunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const method = f.method ?? 8;
    const comp = method === 0 ? f.data : zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);

    // Local File Header (30 字节) + name + data
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    offset += 30 + nameBuf.length + comp.length;

    // Central Directory (46 字节) + name
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset - (30 + nameBuf.length + comp.length), 42);
    centralChunks.push(central, nameBuf);
  }

  // EOCD
  const cdSize = centralChunks.reduce((a, p) => a + p.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...centralChunks, eocd]);
}

// ---------- 命令 ----------
const [,, cmd, arg1, arg2, arg3] = process.argv;

if (cmd === 'unpack') {
  const [apkPath, outDir] = [arg1, arg2];
  if (!apkPath || !outDir) { console.error('用法: node apk_tool.js unpack <apk> <目录>'); process.exit(1); }
  const buf = fs.readFileSync(apkPath);
  const entries = readEntries(buf, readEocd(buf));
  fs.mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const e of entries) {
    const target = path.join(outDir, e.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, extractEntry(buf, e));
    count++;
  }
  console.log(`✅ 解包完成: ${count} 条目 → ${outDir}`);
} else if (cmd === 'repack') {
  const [inDir, outApk] = [arg1, arg2];
  if (!inDir || !outApk) { console.error('用法: node apk_tool.js repack <目录> <apk>'); process.exit(1); }
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ name: path.relative(inDir, full).split(path.sep).join('/'), data: fs.readFileSync(full) });
    }
  };
  walk(inDir);
  // 按名称排序 (稳定输出)
  files.sort((a, b) => a.name < b.name ? -1 : 1);
  fs.writeFileSync(outApk, buildZip(files));
  console.log(`✅ 重打包完成: ${files.length} 条目 → ${outApk}`);
  console.log('   ⚠️ 重打包后需重签名才能安装');
} else if (cmd === 'replace') {
  const [apkPath, innerPath, newFile, outApk] = [arg1, arg2, arg3, process.argv[6]];
  if (!apkPath || !innerPath || !newFile || !outApk) {
    console.error('用法: node apk_tool.js replace <apk> <内部路径> <新文件> <输出apk>');
    process.exit(1);
  }
  const buf = fs.readFileSync(apkPath);
  const entries = readEntries(buf, readEocd(buf));
  const newData = fs.readFileSync(newFile);
  const files = entries.map(e => ({
    name: e.name,
    data: e.name === innerPath ? newData : extractEntry(buf, e)
  }));
  if (!entries.some(e => e.name === innerPath)) {
    files.push({ name: innerPath, data: newData });
  }
  fs.writeFileSync(outApk, buildZip(files));
  console.log(`✅ 已替换 ${innerPath} (${newData.length} 字节) → ${outApk}`);
  console.log('   ⚠️ 需重签名');
} else {
  console.error('用法: node apk_tool.js unpack|repack|replace ...');
  process.exit(1);
}
