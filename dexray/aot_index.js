#!/usr/bin/env node
// DeXRay AI 第三期 · Flutter AOT 字符串索引
// libapp.so 的 .rodata 里是 Dart AOT 编译的字符串池/类名/函数签名。
// 从 .rodata 段提取可读字符串, 建立"字符串 → 类/函数"线索索引。
//
// 用法: node aot_index.js <libapp.so> [--grep 关键词]

const fs = require('fs');

function extractStrings(buf, offset, size, minLen = 6) {
  const end = Math.min(offset + size, buf.length);
  const strings = [];
  let start = -1;
  for (let i = offset; i < end; i++) {
    if (buf[i] >= 0x20 && buf[i] <= 0x7e) {
      if (start < 0) start = i;
    } else {
      if (start >= 0) {
        const len = i - start;
        if (len >= minLen) {
          const s = buf.toString('utf8', start, i);
          // 过滤纯数字/太杂乱的
          if (/[A-Za-z_]/.test(s)) strings.push({ offset: start - offset, text: s });
        }
        start = -1;
      }
    }
  }
  return strings;
}

function parseElfSections(buf) {
  if (buf.toString('ascii', 0, 4) !== '\x7fELF') throw new Error('不是 ELF');
  const is64 = buf[4] === 2;
  let shoff, shentsize, shnum, shstrndx;
  if (is64) {
    shoff = Number(buf.readBigUInt64LE(40));
    shentsize = buf.readUInt16LE(58);
    shnum = buf.readUInt16LE(60);
    shstrndx = buf.readUInt16LE(62);
  } else {
    shoff = buf.readUInt32LE(32);
    shentsize = buf.readUInt16LE(46);
    shnum = buf.readUInt16LE(48);
    shstrndx = buf.readUInt16LE(50);
  }
  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const off = shoff + i * shentsize;
    const nameOff = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const offset = is64 ? Number(buf.readBigUInt64LE(off + 24)) : buf.readUInt32LE(off + 16);
    const size = is64 ? Number(buf.readBigUInt64LE(off + 32)) : buf.readUInt32LE(off + 20);
    sections.push({ nameOff, type, offset, size });
  }
  // 用 shstrndx 定位节名字符串表 (不能找第一个 STRTAB, 那可能是 .dynstr)
  const shstrSection = sections[shstrndx];
  const shstrOff = shstrSection ? shstrSection.offset : 0;
  const named = sections.map(s => {
    let name = '';
    if (shstrOff > 0 && s.nameOff > 0) {
      let end = shstrOff + s.nameOff;
      while (end < buf.length && buf[end] !== 0) end++;
      name = buf.toString('utf8', shstrOff + s.nameOff, end);
    }
    return { ...s, name };
  });
  return named;
}

module.exports = { extractStrings, parseElfSections };

if (require.main === module) {
  // ---------- main ----------
  const [,, file, mode, grepKw] = process.argv;
  if (!file || !fs.existsSync(file)) { console.error('用法: node aot_index.js <libapp.so> [--grep 关键词]'); process.exit(1); }
  const buf = fs.readFileSync(file);
  const sections = parseElfSections(buf);
  const rodata = sections.find(s => s.name === '.rodata');
  if (!rodata) { console.error('未找到 .rodata 段 (可能不是 Flutter AOT)'); process.exit(1); }

  const all = extractStrings(buf, rodata.offset, rodata.size);
  console.log(`Flutter AOT 索引: .rodata ${(rodata.size/1048576).toFixed(1)}MB, 提取 ${all.length} 条字符串`);

  // 分类: Dart 类名/函数签名特征 (元素是 {offset, text})
  const texts = all.map(s => s.text);
  const classes = all.filter(s => /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(s.text));
  const dartSignatures = all.filter(s => s.text.includes('::') || s.text.includes('dart:') || s.text.includes('package:'));
  const urls = all.filter(s => /^https?:\/\//.test(s.text));

let show = all;
if (mode === '--grep') show = all.filter(s => s.text.includes(grepKw));

console.log(`\n统计: 类名样式 ${classes.length}, Dart 引用 ${dartSignatures.length}, URL ${urls.length}`);
console.log(`\n=== 类名样式 (前 20) ===`);
for (const s of classes.slice(0, 20)) console.log(`  ${s.text}`);
console.log(`\n=== Dart 库/签名引用 (前 15) ===`);
for (const s of dartSignatures.slice(0, 15)) console.log(`  ${s.text.slice(0, 80)}`);
if (urls.length) { console.log(`\n=== URL (前 10) ===`); for (const s of urls.slice(0, 10)) console.log(`  ${s.text.slice(0, 80)}`); }
if (mode === '--grep') {
  console.log(`\n=== grep "${grepKw}" 命中 ${show.length} 条 (前 30) ===`);
  for (const s of show.slice(0, 30)) console.log(`  +0x${s.offset.toString(16)} ${s.text.slice(0, 90)}`);
}
}
