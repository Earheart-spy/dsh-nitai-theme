#!/usr/bin/env node
/**
 * 清理 DSH 启动时留下的空会话（“未命名”行）。
 *
 * 这些空会话是 DSH 客户端启动逻辑自己建出来的：每次客户端实例启动，
 * 如果恢复不了上一次的空会话，就会新建一个；实例一多、启动次数一多，
 * 就会在磁盘上留下只有 4 条元数据事件、没有用户消息的会话目录。
 * 它们不属于任何工作区，所以在侧栏里显示成“未分组的未命名会话”。
 *
 * 本脚本只删除同时满足以下三条的会话，其他会话一律不碰：
 *   1. 会话日志小于 2KB（正常对话远大于这个体积）；
 *   2. 日志里没有任何 user/message 或 assistant/message 事件；
 *   3. 会话 id 没有出现在任何工作区的 sessionIds 里。
 *
 * 用法：
 *   node tools/clean-blank-sessions.mjs            # 只统计，不删除（默认）
 *   node tools/clean-blank-sessions.mjs --apply    # 真正删除，并清理归档列表
 *
 * 注意：必须先把 DeepSeek Harness 完全退出再执行 --apply，
 * 否则运行中的客户端会重新写回 workspace.json。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS_DIR = path.join(DSH_HOME, 'sessions');
const WORKSPACE_FILE = path.join(DSH_HOME, 'storages', 'workspace.json');
const APPLY = process.argv.includes('--apply');
const MAX_BLANK_BYTES = 2 * 1024;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function framesOf(buffer) {
  const offsets = [];
  let index = buffer.indexOf(ZSTD_MAGIC, 0);
  while (index !== -1) {
    offsets.push(index);
    index = buffer.indexOf(ZSTD_MAGIC, index + 4);
  }
  const frames = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length;
    frames.push(buffer.subarray(start, end));
  }
  return frames;
}

/** 读一份会话日志，返回是否出现过用户消息或助手消息。解压失败时返回 null，表示无法判断。 */
function hasConversation(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return null;
  }
  const text = [];
  for (const frame of framesOf(raw)) {
    try {
      text.push(zlib.zstdDecompressSync(frame).toString('utf8'));
    } catch {
      return null;
    }
  }
  const joined = text.join('\n');
  if (joined.includes('"type":"user/message"') || joined.includes('"type":"assistant/message"')) return true;
  return false;
}

function loadRegistry() {
  const raw = fs.readFileSync(WORKSPACE_FILE, 'utf8');
  return { raw, data: JSON.parse(raw) };
}

const registry = loadRegistry();
const known = new Set();
for (const workspace of Object.values(registry.data.tables?.workspaces ?? {})) {
  for (const id of workspace.sessionIds ?? []) known.add(id);
}

const candidates = [];
let totalDirs = 0;

for (const group of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
  if (!group.isDirectory()) continue;
  const groupDir = path.join(SESSIONS_DIR, group.name);
  for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    totalDirs += 1;
    const sessionDir = path.join(groupDir, entry.name);
    const log = path.join(sessionDir, 'session.v4.jsonl.zstd');
    let size = 0;
    try {
      size = fs.statSync(log).size;
    } catch {
      continue;
    }
    if (size > MAX_BLANK_BYTES) continue;
    if (known.has(entry.name)) continue;
    const talked = hasConversation(log);
    if (talked !== false) continue;
    candidates.push({
      id: entry.name,
      group: group.name,
      dir: sessionDir,
      size,
      archived: (registry.data.global?.archivedSessionIds ?? []).includes(entry.name),
    });
  }
}

console.log(`DSH 主目录: ${DSH_HOME}`);
console.log(`会话目录总数: ${totalDirs}`);
console.log(`可清理的空会话: ${candidates.length} 个`);
for (const item of candidates) {
  console.log(`  ${item.id}  ${(item.size / 1024).toFixed(1)}KB  归档=${item.archived ? '是' : '否'}`);
}

if (!APPLY) {
  console.log('\n以上只是统计。确认无误后，完全退出 DeepSeek Harness，再执行：');
  console.log('  node tools/clean-blank-sessions.mjs --apply');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = `${WORKSPACE_FILE}.bak-${stamp}`;
fs.copyFileSync(WORKSPACE_FILE, backup);
console.log(`\n已备份工作区登记表: ${backup}`);

let removed = 0;
const deleted = new Set(candidates.map((item) => item.id));
for (const item of candidates) {
  try {
    fs.rmSync(item.dir, { recursive: true, force: true });
    removed += 1;
  } catch (error) {
    console.error(`删除失败 ${item.id}: ${error.message}`);
  }
}

const global = registry.data.global ?? {};
global.archivedSessionIds = (global.archivedSessionIds ?? []).filter((id) => !deleted.has(id));
global.pinnedSessionIds = (global.pinnedSessionIds ?? []).filter((id) => !deleted.has(id));
for (const workspace of Object.values(registry.data.tables?.workspaces ?? {})) {
  if (Array.isArray(workspace.sessionIds)) {
    workspace.sessionIds = workspace.sessionIds.filter((id) => !deleted.has(id));
  }
}
fs.writeFileSync(WORKSPACE_FILE, `${JSON.stringify(registry.data, null, 2)}\n`, 'utf8');

console.log(`已删除 ${removed} 个空会话目录，并从工作区登记表里移除了这些 id。`);
if (removed !== candidates.length) process.exitCode = 1;
