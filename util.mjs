/**
 * util.mjs — 路径、日志、无 BOM 的原子读写。
 *
 * 铁律来源：2026-11-03 凌晨 B 站私信停摆，根因是 PowerShell `Set-Content -Encoding UTF8`
 * 带 BOM 的 JSON 插件读不了。所以这个进程里所有 JSON 都走 writeFileSync(utf8)，不带 BOM。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STATE_DIR = path.join(ROOT, 'state')
export const LOG_DIR = path.join(ROOT, 'logs')

export function ensureDirs() {
  for (const d of [STATE_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true })
}

export function loadConfig() {
  const raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')
  const cfg = JSON.parse(raw)
  // 允许本地覆盖：config.local.json（不进备份、不进版本管理）
  const localPath = path.join(ROOT, 'config.local.json')
  if (fs.existsSync(localPath)) {
    try {
      deepAssign(cfg, JSON.parse(fs.readFileSync(localPath, 'utf8')))
    } catch (e) {
      console.error('[config] config.local.json 解析失败，忽略：', e.message)
    }
  }
  // DSH 每次重启端口会变（64658 → 65301 …），所以以环境变量为准，配置里的只是兜底
  if (process.env.DSH_WEB_URL && cfg.pet) {
    cfg.pet.baseUrl = process.env.DSH_WEB_URL.replace(/\/+$/, '')
  }
  return cfg
}

function deepAssign(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
      deepAssign(dst[k], v)
    } else {
      dst[k] = v
    }
  }
  return dst
}

/** 原子写 JSON：先写 .tmp 再 rename，避免读到半个文件 */
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 追加一行 JSON（jsonl） */
export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8')
}

export function nowIso() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = p(Math.floor(Math.abs(off) / 60))
  const om = p(Math.abs(off) % 60)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${oh}:${om}`
}

/** 本地日期键 YYYY-MM-DD，用于"每天上限"计数 */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const LOG_FILE = () => path.join(LOG_DIR, 'senses.log')

export function log(level, ...args) {
  const line = `${stamp()} [${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`
  console.log(line)
  try {
    ensureDirs()
    fs.appendFileSync(LOG_FILE(), line + '\n', 'utf8')
  } catch { /* 日志写不进去也不能让主流程挂 */ }
}

export const info = (...a) => log('info', ...a)
export const warn = (...a) => log('warn', ...a)
export const error = (...a) => log('error', ...a)

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function homeDir() {
  return process.env.USERPROFILE || os.homedir()
}
