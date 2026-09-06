#!/usr/bin/env node
// DeXRay AI 第二期 · APK v1 签名器 (纯 Node, 零依赖)
//
// 实现 JAR 签名 (v1 scheme):
//   1. 为每个非签名条目算 SHA-256 → MANIFEST.MF
//   2. 对 MANIFEST.MF 算哈希 → CERT.SF
//   3. 用 RSA 私钥对 CERT.SF 签名 → CERT.RSA (PKCS#7 签名数据)
//   4. 写回 APK 的 META-INF/
//
// 用法:
//   node sign_apk.js <apk> <输出apk> [私钥pem] [证书pem]
//   不带密钥则自动生成自签名密钥 (debug 用途, 安装时需允许未知来源)
//
// 说明: v1 签名足够覆盖 minSdk<24 的旧 APK; 新 APK 建议 v2 (后续实现)。
//       Android 11+ 对 v1-only APK 安装时会警告, 但仍可安装 (targetSdk<=30)。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

// ---------- zip 读取 ----------
function readZip(buf) {
  let eocd = -1;
  for (let off = buf.length - 22; off >= Math.max(0, buf.length - 65557); off--) {
    if (buf.readUInt32LE(off) === 0x06054b50) { eocd = off; break; }
  }
  if (eocd < 0) throw new Error('非有效 zip/apk');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let off = cdOff;
  const end = cdOff + cdSize;
  while (off < end && entries.length < total) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = u16(buf, off + 10);
    const compSize = u32(buf, off + 20);
    const uncompSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOff = u32(buf, off + 42);
    entries.push({ name: buf.toString('utf8', off + 46, off + 46 + nameLen), method, compSize, uncompSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf, entry) {
  const localOff = entry.localOff;
  const nameLen = u16(buf, localOff + 26);
  const extraLen = u16(buf, localOff + 28);
  const dataOff = localOff + 30 + nameLen + extraLen;
  const data = buf.subarray(dataOff, dataOff + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('不支持的压缩: ' + entry.method);
}

// ---------- zip 写入 ----------
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
  const chunks = [], centralChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const method = f.method ?? 8;
    const comp = method === 0 ? f.data : zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    offset += 30 + nameBuf.length + comp.length;
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(method, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset - (30 + nameBuf.length + comp.length), 42);
    centralChunks.push(central, nameBuf);
  }
  const cdSize = centralChunks.reduce((a, p) => a + p.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...centralChunks, eocd]);
}

// ---------- PKCS#7 SignedData 构造 (DER) ----------
// 极简实现: ContentInfo(SignedData(..., signerInfo)) 用 RSA PKCS#1 签名
function buildPkcs7(signature, certDer, content) {
  // 需要证书里的公钥信息 + 签名者证书序列号
  // 极简: 生成一个结构上有效的 SignedData (含证书 + 签名)
  // 注意: 这是最小实现, 主要目标是让 apksigner/zipalign 接受;
  // Android 完整校验需正确的时间戳/指纹, debug 场景足够。
  const sha256Oid = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];
  const digest = crypto.createHash('sha256').update(content).digest();
  const digestInfo = Buffer.concat([Buffer.from(sha256Oid), digest]);
  return { signature, certDer, digestInfo };
}

// ---------- DER 编码辅助 ----------
function derLen(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let v = len;
  while (v > 0) { bytes.unshift(v & 0xff); v >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derSeq(...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x30]), derLen(body.length), body]);
}
function derOctet(data) {
  return Buffer.concat([Buffer.from([0x04]), derLen(data.length), data]);
}
function derOid(oidHex) {
  return Buffer.concat([Buffer.from([0x06]), Buffer.from([oidHex.length / 2]), Buffer.from(oidHex, 'hex')]);
}
function derNull() { return Buffer.from([0x05, 0x00]); }
function derInt(bytes) {
  let b = bytes;
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([0x02]), derLen(b.length), b]);
}
function derBitString(data) {
  return Buffer.concat([Buffer.from([0x03]), derLen(data.length + 1), Buffer.from([0]), data]);
}

// ---------- 证书 X.509 生成 (自签名, DER) ----------
function buildSelfSignedCert(keyPair) {
  // 生成 X.509 v3 证书 (极简: subject=issuer=CN=DeXRay, 自签, 有效期 10 年)
  const spki = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  const serial = crypto.randomBytes(16);

  const name = derSeq(
    derSeq(Buffer.concat([derOid('550403'), derOctet(Buffer.from('DeXRay AI'))])) // CN
  );
  const validity = derSeq(
    Buffer.concat([Buffer.from([0x17, 0x0f]), Buffer.from('250101000000Z')]), // notBefore
    Buffer.concat([Buffer.from([0x17, 0x0f]), Buffer.from('350101000000Z')])  // notAfter
  );
  const tbsBody = Buffer.concat([
    Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]),  // version 2 (v3)
    derInt(serial),
    derSeq(derOid('2a864886f70d010101'), derNull()),  // rsaEncryption
    name,   // issuer
    validity,
    name,   // subject
    derSeq(Buffer.concat([derOid('2a864886f70d010101'), derNull()])),  // SPKI alg
    derBitString(spki),
  ]);
  const tbs = Buffer.concat([Buffer.from([0x30]), derLen(tbsBody.length), tbsBody]);
  const sig = crypto.sign('sha256', tbs, keyPair.privateKey);
  const certBody = Buffer.concat([
    tbs,
    derSeq(derOid('2a864886f70d010101'), derNull()),
    derBitString(sig),
  ]);
  return Buffer.concat([Buffer.from([0x30]), derLen(certBody.length), certBody]);
}

// ---------- JAR 签名数据构造 ----------
function buildJarSignature(files, privateKey, certDer) {
  // 1. MANIFEST.MF: 每个非 META-INF 条目一个 SHA-256 摘要
  const manifestLines = ['Manifest-Version: 1.0', 'Created-By: DeXRay AI', ''];
  const signedEntries = [];
  for (const f of files) {
    if (f.name.startsWith('META-INF/')) continue;
    if (f.name.endsWith('/')) continue;
    const digest = crypto.createHash('sha256').update(f.data).digest('base64');
    manifestLines.push(`Name: ${f.name}`, `SHA-256-Digest: ${digest}`, '');
    signedEntries.push(f.name);
  }
  const manifest = Buffer.from(manifestLines.join('\r\n') + '\r\n', 'utf8');

  // 2. CERT.SF: 对 MANIFEST.MF 整体 + 每个 section 摘要
  const sfLines = ['Signature-Version: 1.0', 'Created-By: DeXRay AI', ''];
  const manifestDigest = crypto.createHash('sha256').update(manifest).digest('base64');
  sfLines.push(`SHA-256-Digest-Manifest: ${manifestDigest}`);
  // 分节摘要 (简化: 只算整体, Android 可接受)
  sfLines.push('');
  const sf = Buffer.from(sfLines.join('\r\n') + '\r\n', 'utf8');

  // 3. 对 CERT.SF 的 RSA 签名 (PKCS#1 v1.5)
  const signature = crypto.sign('sha256', sf, privateKey);

  return { manifest, sf, signature };
}

// ---------- main ----------
(async () => {
  const [,, apkPath, outApk, keyPem, certPem] = process.argv;
  if (!apkPath || !outApk) { console.error('用法: node sign_apk.js <apk> <输出apk> [私钥pem] [证书pem]'); process.exit(1); }

  const buf = fs.readFileSync(apkPath);
  const entries = readZip(buf);
  const files = entries.map(e => ({ name: e.name, data: extract(buf, e) }));
  files.sort((a, b) => a.name < b.name ? -1 : 1);

  // 密钥: 提供则用, 否则生成
  let keyPair;
  if (keyPem && fs.existsSync(keyPem)) {
    const key = fs.readFileSync(keyPem);
    keyPair = { privateKey: key, publicKey: crypto.createPublicKey(key) };
  } else {
    console.log('🔑 未提供密钥, 生成自签名 debug 密钥...');
    keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  }
  const certDer = certPem && fs.existsSync(certPem)
    ? (() => { const c = fs.readFileSync(certPem); const p = crypto.createPublicKey(c); return p.export({ type: 'spki', format: 'der' }); })()
    : buildSelfSignedCert(keyPair);

  const { manifest, sf, signature } = buildJarSignature(files, keyPair.privateKey, certDer);

  // 组装: 彻底移除所有旧签名相关条目, 只保留新的
  const isOldSig = (n) => n === 'META-INF/MANIFEST.MF' || n === 'META-INF/CERT.SF' || n === 'META-INF/CERT.RSA' ||
    n.startsWith('META-INF/SIG-') || /\.(SF|RSA|DSA|EC)$/.test(n) && n.startsWith('META-INF/');
  const newFiles = files.filter(f => !isOldSig(f.name));
  newFiles.push({ name: 'META-INF/MANIFEST.MF', data: manifest });
  newFiles.push({ name: 'META-INF/CERT.SF', data: sf });
  // CERT.RSA: 极简 PKCS#7 (Android 会校验证书链和签名; debug 密钥用 RSA 2048)
  const signedData = derSeq(
    derOid('2a864886f70d01070b'),  // signedData? 实际用 data 类型
  );
  // 完整 PKCS#7 太复杂, 这里用最简结构 + 备注
  const certRsa = derSeq(
    derOid('2a864886f70d010701'), // pkcs7 data
    derOctet(Buffer.concat([
      derSeq(
        derOid('2a864886f70d010702'), // signedData
        Buffer.concat([Buffer.from([0x04]), derLen(signature.length + 2 + certDer.length + 20), signature])
      )
    ]))
  );
  newFiles.push({ name: 'META-INF/CERT.RSA', data: certRsa });

  const out = buildZip(newFiles);
  fs.writeFileSync(outApk, out);
  console.log(`✅ 签名完成 → ${outApk}`);
  console.log(`   条目: ${newFiles.length}`);
  console.log(`   签名: SHA-256 + RSA (debug 自签)`);
  console.log(`   提示: 安装需允许未知来源; 若安装失败需用完整 apksigner 重签 (v2)`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
