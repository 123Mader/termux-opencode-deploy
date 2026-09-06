#!/usr/bin/env node
// 批量推送本地目录到 GitHub 仓库 (git-data API, 无需 git)
// 用法: node gh_push.js <本地目录> <owner/repo> <目标子目录> [--branch main] [--concurrency 8]
const fs = require('fs');
const path = require('path');

const TOKEN = fs.readFileSync('/storage/emulated/0/MT2/apks/gh_token.txt', 'utf8').trim();
const [,, srcDir, repo, destDir, ...rest] = process.argv;
const branch = rest[rest.indexOf('--branch') + 1] || 'main';
const concurrency = Number(rest[rest.indexOf('--concurrency') + 1]) || 8;

if (!srcDir || !repo) { console.error('用法: node gh_push.js <目录> <owner/repo> <目标子目录>'); process.exit(1); }

const API = 'https://api.github.com';
const HEADERS = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'dexray-push' };

async function api(url, body, method = 'POST') {
  const res = await fetch(API + url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API ${res.status} ${url}: ${j.message || JSON.stringify(j).slice(0, 120)}`);
  return j;
}

// 收集文件 (排除 .git/build/.dart_tool)
function collect(dir, prefix) {
  const files = [];
  const walk = (d, p) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['.git', 'build', '.dart_tool'].includes(e.name)) continue;
      const full = path.join(d, e.name);
      const rel = p ? p + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, rel);
      else files.push({ rel, full });
    }
  };
  walk(dir, prefix);
  return files;
}

// 并行限制执行器
async function pool(items, fn, n) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  console.log(`📦 收集文件: ${srcDir} → ${repo}/${destDir}/ (分支 ${branch})`);
  const files = collect(srcDir, destDir);
  console.log(`   共 ${files.length} 个文件, ${(fs.statSync(srcDir).size / 1048576).toFixed(1)}MB+`);

  // 1. 建 blob
  console.log('⏳ 创建 blobs (并发 ' + concurrency + ')...');
  let done = 0, failed = 0;
  const treeEntries = await pool(files, async (f) => {
    try {
      const data = fs.readFileSync(f.full);
      const content = data.toString('base64');
      const blob = await api(`/repos/${repo}/git/blobs`, { content, encoding: 'base64' });
      done++;
      if (done % 200 === 0) console.log(`   ...${done}/${files.length}`);
      return { path: f.rel, mode: '100644', type: 'blob', sha: blob.sha };
    } catch (e) {
      failed++;
      console.error(`   ❌ ${f.rel}: ${e.message.slice(0, 100)}`);
      return null;
    }
  }, concurrency).then(list => list.filter(Boolean));

  if (treeEntries.length === 0) { console.error('❌ 无有效 blob'); process.exit(1); }
  console.log(`✅ blobs 完成: ${treeEntries.length} 成功, ${failed} 失败`);

  // 2. 建树 (分批, 每批 800 条目, 递归合并)
  console.log('⏳ 构建 git tree...');
  async function buildTree(entries) {
    if (entries.length <= 800) {
      const t = await api(`/repos/${repo}/git/trees`, { tree: entries });
      return t.sha;
    }
    // 按路径首段分组建子树
    const groups = new Map();
    for (const e of entries) {
      const top = e.path.includes('/') ? e.path.split('/')[0] : '__root__';
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(e);
    }
    const subEntries = [];
    for (const [top, sub] of groups) {
      if (top === '__root__') {
        for (const e of sub) subEntries.push(e);
      } else {
        const subTreeEntries = sub.map(e => ({ ...e, path: e.path.slice(top.length + 1) }));
        const sha = await buildTree(subTreeEntries);
        subEntries.push({ path: top, mode: '040000', type: 'tree', sha });
      }
    }
    return buildTree(subEntries);
  }
  const treeSha = await buildTree(treeEntries);
  console.log('✅ tree:', treeSha.slice(0, 12));

  // 3. commit
  const head = await api(`/repos/${repo}/branches/${branch}`, null, 'GET');
  const parent = head.commit.sha;
  console.log('📌 parent:', parent.slice(0, 12));
  const commit = await api(`/repos/${repo}/git/commits`, {
    message: `DeXRay AI: import Kelivo source (${treeEntries.length} files)`,
    tree: treeSha,
    parents: [parent]
  });
  console.log('✅ commit:', commit.sha.slice(0, 12));

  // 4. 更新 ref
  await api(`/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true }, 'PATCH');
  console.log(`🎉 推送完成! ${repo}@${branch} → ${commit.sha.slice(0, 12)}`);
  console.log(`   https://github.com/${repo}/tree/${branch}/${destDir}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
