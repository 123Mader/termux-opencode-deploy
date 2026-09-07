#!/usr/bin/env node
// DeXRay AI 第二期 · DEX 解析器
// 完整解析 classes.dex: header → string/type/proto/field/method id 表 → class_defs
// 输出: 类列表、方法签名、字段 (伪 smali 骨架, 为后续读写打基础)
//
// 用法: node dex_parser.js <classes.dex> [--json]
//   默认输出人类可读的类/方法/字段清单
//   --json 输出结构化 JSON (供 MCP 工具/后续修改引擎用)

const fs = require('fs');
const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

// ---------- uleb128 读取 ----------
function readUleb128(b, off) {
  let result = 0, shift = 0;
  while (true) {
    const byte = b[off++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, next: off };
}

// ---------- 类型名美化: Lcom/foo/Bar; → com.foo.Bar ----------
function prettyType(raw) {
  if (!raw) return '?';
  if (raw.startsWith('L') && raw.endsWith(';')) return raw.slice(1, -1).replace(/\//g, '.');
  if (raw === 'V') return 'void';
  if (raw === 'I') return 'int';
  if (raw === 'J') return 'long';
  if (raw === 'Z') return 'boolean';
  if (raw === 'B') return 'byte';
  if (raw === 'S') return 'short';
  if (raw === 'C') return 'char';
  if (raw === 'F') return 'float';
  if (raw === 'D') return 'double';
  if (raw.startsWith('[')) return prettyType(raw.slice(1)) + '[]';
  return raw;
}

// ---------- 访问标志 ----------
const ACCESS = {
  0x1: 'public', 0x2: 'private', 0x4: 'protected', 0x8: 'static',
  0x10: 'final', 0x20: 'synchronized', 0x40: 'volatile', 0x80: 'transient',
  0x100: 'native', 0x200: 'interface', 0x400: 'abstract', 0x1000: 'synthetic',
  0x2000: 'annotation', 0x4000: 'enum', 0x10000: 'constructor', 0x20000: 'declared-synchronized'
};
function accessString(flags) {
  const parts = [];
  for (const [bit, name] of Object.entries(ACCESS)) {
    if (flags & Number(bit)) parts.push(name);
  }
  return parts.join(' ') || 'package';
}

// ---------- 主解析 ----------
function parseDex(buf) {
  if (buf.length < 112) throw new Error('文件太小, 不是有效 dex');
  if (buf.toString('ascii', 0, 4) !== 'dex\n') throw new Error('不是 DEX 文件 (magic: ' + buf.toString('ascii', 0, 4) + ')');

  // header
  const h = {
    stringIdsSize: u32(buf, 56), stringIdsOff: u32(buf, 60),
    typeIdsSize: u32(buf, 64), typeIdsOff: u32(buf, 68),
    protoIdsSize: u32(buf, 72), protoIdsOff: u32(buf, 76),
    fieldIdsSize: u32(buf, 80), fieldIdsOff: u32(buf, 84),
    methodIdsSize: u32(buf, 88), methodIdsOff: u32(buf, 92),
    classDefsSize: u32(buf, 96), classDefsOff: u32(buf, 100),
  };

  // string_ids: 每个 u32 指向 string_data
  const strings = [];
  for (let i = 0; i < h.stringIdsSize; i++) {
    const dataOff = u32(buf, h.stringIdsOff + i * 4);
    let p = dataOff;
    // uleb128 字符数
    const lenRes = readUleb128(buf, p);
    p = lenRes.next;
    // MUTF-8 读 (含 0 结尾)
    let end = p;
    while (end < buf.length && buf[end] !== 0) end++;
    strings.push(buf.toString('utf8', p, end));
  }

  // type_ids: 每个 u32 是 string 索引 (descriptor)
  const types = [];
  for (let i = 0; i < h.typeIdsSize; i++) {
    const strIdx = u32(buf, h.typeIdsOff + i * 4);
    types.push(strings[strIdx] ?? '?');
  }

  // proto_ids: shorty_idx(u32) return_type_idx(u32) parameters_off(u32)
  const protos = [];
  for (let i = 0; i < h.protoIdsSize; i++) {
    const off = h.protoIdsOff + i * 12;
    const shortyIdx = u32(buf, off);
    const returnIdx = u32(buf, off + 4);
    const paramsOff = u32(buf, off + 8);
    const params = [];
    if (paramsOff !== 0) {
      const count = u32(buf, paramsOff);
      for (let j = 0; j < count; j++) {
        const typeIdx = u16(buf, paramsOff + 4 + j * 2);
        params.push(types[typeIdx] ?? '?');
      }
    }
    protos.push({
      shorty: strings[shortyIdx] ?? '?',
      returnType: types[returnIdx] ?? '?',
      params
    });
  }

  // field_ids: class_idx(u16) type_idx(u16) name_idx(u32)
  const fields = [];
  for (let i = 0; i < h.fieldIdsSize; i++) {
    const off = h.fieldIdsOff + i * 8;
    fields.push({
      classIdx: u16(buf, off),
      typeIdx: u16(buf, off + 2),
      nameIdx: u32(buf, off + 4)
    });
  }

  // method_ids: class_idx(u16) proto_idx(u16) name_idx(u32)
  const methods = [];
  for (let i = 0; i < h.methodIdsSize; i++) {
    const off = h.methodIdsOff + i * 8;
    methods.push({
      classIdx: u16(buf, off),
      protoIdx: u16(buf, off + 2),
      nameIdx: u32(buf, off + 4)
    });
  }

  // class_defs: class_idx(u32) access_flags(u32) superclass_idx(u32) interfaces_off(u32)
  //             source_file_idx(u32) annotations_off(u32) class_data_off(u32) static_values_off(u32)
  const classes = [];
  for (let i = 0; i < h.classDefsSize; i++) {
    const off = h.classDefsOff + i * 32;
    const classIdx = u32(buf, off);
    const accessFlags = u32(buf, off + 4);
    const superclassIdx = u32(buf, off + 8);
    const interfacesOff = u32(buf, off + 12);
    const classDataOff = u32(buf, off + 24);

    const interfaces = [];
    if (interfacesOff !== 0) {
      const count = u32(buf, interfacesOff);
      for (let j = 0; j < count; j++) {
        const typeIdx = u16(buf, interfacesOff + 4 + j * 2);
        interfaces.push(types[typeIdx] ?? '?');
      }
    }

    // class_data: 字段+方法 (uleb128 差分编码)
    const classFields = [];
    const classMethods = [];
    if (classDataOff !== 0) {
      let p = classDataOff;
      const staticFieldsSize = readUleb128(buf, p); p = staticFieldsSize.next;
      const instanceFieldsSize = readUleb128(buf, p); p = instanceFieldsSize.next;
      const directMethodsSize = readUleb128(buf, p); p = directMethodsSize.next;
      const virtualMethodsSize = readUleb128(buf, p); p = virtualMethodsSize.next;

      let fieldIdx = 0;
      const readFieldList = (n) => {
        const list = [];
        for (let j = 0; j < n; j++) {
          const diff = readUleb128(buf, p); p = diff.next;
          const flags = readUleb128(buf, p); p = flags.next;
          fieldIdx += diff.value;
          const f = fields[fieldIdx];
          list.push({
            name: f ? strings[f.nameIdx] : '?',
            type: f ? prettyType(types[f.typeIdx]) : '?',
            access: accessString(flags.value)
          });
        }
        return list;
      };
      const sFields = readFieldList(staticFieldsSize.value);
      const iFields = readFieldList(instanceFieldsSize.value);
      classFields.push(...sFields, ...iFields);

      let methodIdx = 0;
      const readMethodList = (n, kind) => {
        const list = [];
        for (let j = 0; j < n; j++) {
          const diff = readUleb128(buf, p); p = diff.next;
          const flags = readUleb128(buf, p); p = flags.next;
          const codeOff = readUleb128(buf, p); p = codeOff.next;
          methodIdx += diff.value;
          const m = methods[methodIdx];
          if (m) {
            const proto = protos[m.protoIdx];
            list.push({
              name: strings[m.nameIdx] ?? '?',
              returnType: proto ? prettyType(proto.returnType) : '?',
              params: proto ? proto.params.map(prettyType) : [],
              access: accessString(flags.value),
              hasCode: codeOff.value !== 0,
              kind
            });
          }
        }
        return list;
      };
      const dMethods = readMethodList(directMethodsSize.value, 'direct');
      const vMethods = readMethodList(virtualMethodsSize.value, 'virtual');
      classMethods.push(...dMethods, ...vMethods);
    }

    classes.push({
      name: prettyType(types[classIdx]),
      access: accessString(accessFlags),
      superclass: superclassIdx === 0xffffffff ? null : prettyType(types[superclassIdx]),
      interfaces,
      fields: classFields,
      methods: classMethods
    });
  }

  return {
    stats: {
      strings: h.stringIdsSize,
      types: h.typeIdsSize,
      protos: h.protoIdsSize,
      fields: h.fieldIdsSize,
      methods: h.methodIdsSize,
      classes: h.classDefsSize
    },
    classes
  };
}

// ---------- 输出 ----------
function printHuman(dex) {
  console.log(`DEX 统计: 字符串=${dex.stats.strings} 类型=${dex.stats.types} 原型=${dex.stats.protos} 字段=${dex.stats.fields} 方法=${dex.stats.methods} 类=${dex.stats.classes}`);
  console.log(`\n=== 类清单 (前 40 个) ===`);
  for (const c of dex.classes.slice(0, 40)) {
    console.log(`\n${c.access} class ${c.name}${c.superclass ? ' extends ' + c.superclass : ''}${c.interfaces.length ? ' implements ' + c.interfaces.join(',') : ''}`);
    for (const f of c.fields.slice(0, 5)) console.log(`    field ${f.access} ${f.type} ${f.name}`);
    for (const m of c.methods.slice(0, 8)) console.log(`    method ${m.access} ${m.returnType} ${m.name}(${m.params.join(', ')})${m.hasCode ? '' : ' [abstract/native]'}`);
    if (c.fields.length > 5 || c.methods.length > 8) console.log(`    ... (共 ${c.fields.length} 字段, ${c.methods.length} 方法)`);
  }
  if (dex.classes.length > 40) console.log(`\n... 共 ${dex.classes.length} 个类`);
}

// ---------- main ----------
module.exports = { parseDex, prettyType };

if (require.main === module) {
  const [,, dexFile, mode] = process.argv;
  if (!dexFile || !fs.existsSync(dexFile)) {
    console.error('用法: node dex_parser.js <classes.dex> [--json]');
    process.exit(1);
  }
  const buf = fs.readFileSync(dexFile);
  const dex = parseDex(buf);

  if (mode === '--json') {
    process.stdout.write(JSON.stringify(dex, null, 2));
  } else {
    printHuman(dex);
  }
}
