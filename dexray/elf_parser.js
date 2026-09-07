#!/usr/bin/env node
// DeXRay AI 第三期 · ELF/SO 解析器
// 解析 ELF 头 → 节表 → 符号表 → 字符串 → 导入/导出函数
//
// 用法: node elf_parser.js <lib.so> [--json]
//   默认输出人类可读分析
//   --json 输出结构化 JSON

const fs = require('fs');

const MACHINES = { 0x3e: 'x86-64', 0xb7: 'AArch64', 0x28: 'ARM', 0x03: 'x86', 0x02: 'SPARC' };
const TYPES = { 0: 'NONE', 1: 'REL', 2: 'EXEC', 3: 'DYN', 4: 'CORE' };
const STT = { 0: 'NOTYPE', 1: 'OBJECT', 2: 'FUNC', 3: 'SECTION', 4: 'FILE', 5: 'COMMON', 6: 'TLS' };
const STB = { 0: 'LOCAL', 1: 'GLOBAL', 2: 'WEAK', 10: 'GNU_UNIQUE' };

function parseElf(buf) {
  if (buf.toString('ascii', 0, 4) !== '\x7fELF') throw new Error('不是 ELF 文件');
  const is64 = buf[4] === 2;
  const machine = buf.readUInt16LE(18);
  const type = buf.readUInt16LE(16);

  const result = {
    is64, machine: MACHINES[machine] || ('0x' + machine.toString(16)),
    type: TYPES[type] || ('0x' + type.toString(16)),
    size: buf.length
  };

  if (is64) {
    const shoff = Number(buf.readBigUInt64LE(40));
    const shentsize = buf.readUInt16LE(58);
    const shnum = buf.readUInt16LE(60);
    const shstrndx = buf.readUInt16LE(62);
    result.sections = parseSections64(buf, shoff, shentsize, shnum, shstrndx);
    result.symbols = parseSymbols64(buf, result.sections);
  } else {
    const shoff = buf.readUInt32LE(32);
    const shentsize = buf.readUInt16LE(46);
    const shnum = buf.readUInt16LE(48);
    const shstrndx = buf.readUInt16LE(50);
    result.sections = parseSections32(buf, shoff, shentsize, shnum, shstrndx);
    result.symbols = parseSymbols32(buf, result.sections);
  }
  return result;
}

// ---------- 64位节表 ----------
function parseSections64(buf, shoff, shentsize, shnum, shstrndx) {
  const sections = [];
  const shstrOff = (() => {
    if (shstrndx >= shnum) return 0;
    const off = shoff + shstrndx * shentsize;
    return Number(buf.readBigUInt64LE(off + 24)); // sh_offset
  })();
  for (let i = 0; i < shnum; i++) {
    const off = shoff + i * shentsize;
    const nameOff = buf.readUInt32LE(off);
    const shType = buf.readUInt32LE(off + 4);
    const shOffset = Number(buf.readBigUInt64LE(off + 24));
    const shSize = Number(buf.readBigUInt64LE(off + 32));
    const shLink = buf.readUInt32LE(off + 40);
    const shInfo = buf.readUInt32LE(off + 44);
    const shEntsize = buf.readBigUInt64LE(off + 56);
    let name = '';
    if (shstrOff > 0 && nameOff > 0) {
      let end = shstrOff + nameOff;
      while (end < buf.length && buf[end] !== 0) end++;
      name = buf.toString('utf8', shstrOff + nameOff, end);
    }
    const types = { 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 4: 'RELA', 5: 'HASH', 6: 'DYNAMIC', 7: 'NOTE', 8: 'NOBITS', 9: 'REL', 11: 'DYNSYM', 14: 'INIT_ARRAY', 15: 'FINI_ARRAY', 16: 'PREINIT_ARRAY', 17: 'GROUP', 18: 'SYMTAB_SHNDX' };
    sections.push({
      name, type: types[shType] || ('0x' + shType.toString(16)),
      offset: shOffset, size: shSize, link: shLink, info: shInfo, entsize: Number(shEntsize)
    });
  }
  return sections;
}

// ---------- 32位节表 ----------
function parseSections32(buf, shoff, shentsize, shnum, shstrndx) {
  const sections = [];
  const shstrOff = (() => {
    if (shstrndx >= shnum) return 0;
    const off = shoff + shstrndx * shentsize;
    return buf.readUInt32LE(off + 16);
  })();
  for (let i = 0; i < shnum; i++) {
    const off = shoff + i * shentsize;
    const nameOff = buf.readUInt32LE(off);
    const shType = buf.readUInt32LE(off + 4);
    const shOffset = buf.readUInt32LE(off + 16);
    const shSize = buf.readUInt32LE(off + 20);
    const shLink = buf.readUInt32LE(off + 24);
    const shInfo = buf.readUInt32LE(off + 28);
    const shEntsize = buf.readUInt32LE(off + 36);
    let name = '';
    if (shstrOff > 0 && nameOff > 0) {
      let end = shstrOff + nameOff;
      while (end < buf.length && buf[end] !== 0) end++;
      name = buf.toString('utf8', shstrOff + nameOff, end);
    }
    const types = { 1: 'PROGBITS', 2: 'SYMTAB', 3: 'STRTAB', 4: 'RELA', 5: 'HASH', 6: 'DYNAMIC', 7: 'NOTE', 8: 'NOBITS', 9: 'REL', 11: 'DYNSYM', 14: 'INIT_ARRAY', 15: 'FINI_ARRAY' };
    sections.push({
      name, type: types[shType] || ('0x' + shType.toString(16)),
      offset: shOffset, size: shSize, link: shLink, info: shInfo, entsize: shEntsize
    });
  }
  return sections;
}

// ---------- 符号表解析 ----------
function parseSymbols64(buf, sections) {
  const dynsym = sections.find(s => s.type === 'DYNSYM');
  const symtab = sections.find(s => s.type === 'SYMTAB');
  const collect = (symSec, strSecName) => {
    if (!symSec || !symSec.entsize) return [];
    const strSec = sections.find(s => s.name === strSecName);
    if (!strSec) return [];
    const count = symSec.size / symSec.entsize;
    const symbols = [];
    for (let i = 0; i < count; i++) {
      const off = symSec.offset + i * Number(symSec.entsize);
      const nameOff = buf.readUInt32LE(off);
      const info = buf.readUInt8(off + 4);
      const shndx = buf.readUInt16LE(off + 6);
      const value = buf.readBigUInt64LE(off + 8);
      const size = buf.readBigUInt64LE(off + 16);
      const type = STT[info & 0xf] || '?';
      const bind = STB[(info >> 4) & 0xf] || '?';
      let name = '';
      if (nameOff > 0 && strSec.offset + nameOff < buf.length) {
        let end = strSec.offset + nameOff;
        while (end < buf.length && buf[end] !== 0) end++;
        name = buf.toString('utf8', strSec.offset + nameOff, end);
      }
      if (name) symbols.push({ name, type, bind, value: '0x' + value.toString(16), size: Number(size), section: shndx });
    }
    return symbols;
  };
  return {
    dynsym: collect(dynsym, '.dynstr'),
    symtab: collect(symtab, '.strtab')
  };
}

function parseSymbols32(buf, sections) {
  const dynsym = sections.find(s => s.type === 'DYNSYM');
  const symtab = sections.find(s => s.type === 'SYMTAB');
  const collect = (symSec, strSecName) => {
    if (!symSec || !symSec.entsize) return [];
    const strSec = sections.find(s => s.name === strSecName);
    if (!strSec) return [];
    const count = symSec.size / symSec.entsize;
    const symbols = [];
    for (let i = 0; i < count; i++) {
      const off = symSec.offset + i * symSec.entsize;
      const nameOff = buf.readUInt32LE(off);
      const value = buf.readUInt32LE(off + 4);
      const size = buf.readUInt32LE(off + 8);
      const info = buf.readUInt8(off + 12);
      const shndx = buf.readUInt16LE(off + 14);
      const type = STT[info & 0xf] || '?';
      const bind = STB[(info >> 4) & 0xf] || '?';
      let name = '';
      if (nameOff > 0 && strSec.offset + nameOff < buf.length) {
        let end = strSec.offset + nameOff;
        while (end < buf.length && buf[end] !== 0) end++;
        name = buf.toString('utf8', strSec.offset + nameOff, end);
      }
      if (name) symbols.push({ name, type, bind, value: '0x' + value.toString(16), size, section: shndx });
    }
    return symbols;
  };
  return {
    dynsym: collect(dynsym, '.dynstr'),
    symtab: collect(symtab, '.strtab')
  };
}

// ---------- 加固/加密特征检测 ----------
function detectPacking(buf, sections, symbols) {
  const allSymbols = [...(symbols.dynsym || []), ...(symbols.symtab || [])];
  const names = allSymbols.map(s => s.name).join(' ');
  const markers = [];
  if (/UPX/.test(buf.toString('latin1', 0, Math.min(64, buf.length)))) markers.push('UPX 加壳');
  if (/ollvm|obfus/.test(names)) markers.push('OLLVM 混淆');
  if (sections.some(s => s.name === '.packed' || s.name === '.upx')) markers.push('自定义加壳节');
  if (/frida|substrate|xposed|dexposed/.test(names)) markers.push('Hook 框架符号 (frida/xposed)');
  if (/__android_log_print|_ZN7android6LogMsgC/.test(names)) markers.push('Android 日志系统');
  if (allSymbols.some(s => s.name.startsWith('JNI_OnLoad'))) markers.push('JNI 入口 (JNI_OnLoad)');
  return { markers, hasJniOnLoad: allSymbols.some(s => s.name === 'JNI_OnLoad') };
}

// ---------- 输出 ----------
function printHuman(elf) {
  console.log(`ELF: ${elf.machine} ${elf.type} ${elf.is64 ? '64位' : '32位'} (${(elf.size / 1024).toFixed(0)}KB)`);
  const sections = elf.sections || [];
  console.log(`\n节表 (${sections.length}):`);
  for (const s of sections.filter(s => s.name && s.size > 0)) {
    console.log(`  ${s.name.padEnd(28)} ${s.type.padEnd(10)} ${(s.size / 1024).toFixed(1)}KB`);
  }
  const dyn = elf.symbols?.dynsym || [];
  const sym = elf.symbols?.symtab || [];
  console.log(`\n动态符号 (${dyn.length}) + 静态符号 (${sym.length})`);
  console.log(`\n导出函数 (GLOBAL FUNC, 前 20):`);
  for (const s of dyn.filter(s => s.bind === 'GLOBAL' && s.type === 'FUNC').slice(0, 20)) {
    console.log(`  ${s.value} ${s.name}`);
  }
  console.log(`\n导入函数 (UND, 前 20):`);
  for (const s of dyn.filter(s => s.section === 0 && s.type === 'FUNC').slice(0, 20)) {
    console.log(`  ${s.name}`);
  }
  const pack = detectPacking(require('fs').readFileSync('/dev/stdin'), elf.sections, elf.symbols);
  console.log(`\n特征: ${pack.markers.join(', ') || '无已知加固/混淆特征'}`);
}

// ---------- main ----------
module.exports = { parseElf, detectPacking };

if (require.main === module) {
  const [,, file, mode] = process.argv;
  if (!file || !fs.existsSync(file)) { console.error('用法: node elf_parser.js <lib.so> [--json]'); process.exit(1); }
  const buf = fs.readFileSync(file);
  const elf = parseElf(buf);
  if (mode === '--json') {
    process.stdout.write(JSON.stringify(elf, null, 2));
  } else {
    console.log(`ELF: ${elf.machine} ${elf.type} ${elf.is64 ? '64位' : '32位'} (${(elf.size / 1024).toFixed(0)}KB)`);
    const sections = elf.sections || [];
    console.log(`\n节表 (${sections.length}):`);
    for (const s of sections.filter(s => s.name && s.size > 0)) {
      console.log(`  ${s.name.padEnd(28)} ${s.type.padEnd(10)} ${(s.size / 1024).toFixed(1)}KB`);
    }
    const dyn = elf.symbols?.dynsym || [];
    const sym = elf.symbols?.symtab || [];
    console.log(`\n动态符号 (${dyn.length}) + 静态符号 (${sym.length})`);
    console.log(`\n导出函数 (GLOBAL FUNC, 前 20):`);
    for (const s of dyn.filter(s => s.bind === 'GLOBAL' && s.type === 'FUNC' && s.section !== 0).slice(0, 20)) {
      console.log(`  ${s.value} ${s.name}`);
    }
    console.log(`\n导入函数 (UND, 前 20):`);
    for (const s of dyn.filter(s => s.section === 0 && s.type === 'FUNC').slice(0, 20)) {
      console.log(`  ${s.name}`);
    }
    const pack = detectPacking(buf, elf.sections, elf.symbols);
    console.log(`\n特征: ${pack.markers.join(', ') || '无已知加固/混淆特征'}`);
  }
}
