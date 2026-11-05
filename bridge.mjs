/**
 * bridge.mjs — 跟 dsh-senses-bridge 打交道的客户端（走文件，不走 HTTP）。
 *
 * 为什么是文件：实测 DSH 的 Web 端口对 /api 和插件路由一律先过会话鉴权，
 * 外部进程没有 loopback cookie：
 *   GET /dsh-bili/api/settings → 401   （那个插件明明挂着）
 *   GET /senses/status         → 401
 * 所以桥用文件当总线：inbox 投请求、outbox 取结果。不需要端口、不需要鉴权。
 */

import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './util.mjs'

export function createBridge(cfg) {
  const root = path.join(cfg.bridge.dshHome, 'senses-bridge')
  const inbox = path.join(root, 'inbox')
  const outbox = path.join(root, 'outbox')

  function ensure() {
    fs.mkdirSync(inbox, { recursive: true })
    fs.mkdirSync(outbox, { recursive: true })
  }

  let seq = 0
  function newId() {
    seq = (seq + 1) % 1000
    return `${Date.now()}-${String(seq).padStart(3, '0')}`
  }

  /**
   * 投一轮，等她的回复。
   * @returns {Promise<{ok:boolean, reply?:string, turn?:number, tookMs?:number, reason?:string}>}
   */
  async function deliver(text, { timeoutMs, sessionId, cwd } = {}) {
    ensure()
    const t = Number(timeoutMs) || cfg.bridge.timeoutMs
    const id = newId()
    const job = { id, text, at: Date.now(), timeoutMs: t }
    if (sessionId) job.sessionId = sessionId
    if (cwd) job.cwd = cwd

    const inFile = path.join(inbox, `${id}.json`)
    const tmp = `${inFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2), 'utf8')
    fs.renameSync(tmp, inFile)

    const outFile = path.join(outbox, `${id}.json`)
    const deadline = Date.now() + t
    while (Date.now() < deadline) {
      if (fs.existsSync(outFile)) {
        try {
          const r = JSON.parse(fs.readFileSync(outFile, 'utf8'))
          // 自清理：结果读完就删，免得 outbox 越积越多
          try { fs.unlinkSync(outFile) } catch { /* 下次再说 */ }
          return r
        } catch {
          // 文件可能正在写，下一拍再读
        }
      }
      await sleep(cfg.bridge.pollMs || 150)
    }
    return { ok: false, reason: 'timeout', id }
  }

  /** 桥是不是活着：inbox 目录存在且最近有心跳（桥不会写心跳，这里只看目录在不在） */
  function alive() {
    return fs.existsSync(inbox)
  }

  return { deliver, alive, dirs: { root, inbox, outbox } }
}
