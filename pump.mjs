/**
 * pump.mjs — 文件投递泵。
 *
 * 为什么不用 HTTP：**实测**了，DSH 的 Web 端口对 /api 和插件路由一律先过会话鉴权，
 * 外部进程没有那个 loopback cookie（token exchange 在渲染进程里），所以
 *   GET /dsh-bili/api/settings → 401   （这个插件明明挂着）
 *   GET /senses/status         → 401
 * 也就是说外部进程打不进任何插件路由。改用文件当总线：不需要端口、不需要鉴权、
 * 也不会因为 DSH 换端口而失效。
 *
 * 目录（都在 ~/.dsh/senses-bridge/ 下）：
 *   inbox/<id>.json    外部写：{id, text, sessionId?, cwd?, timeoutMs?}
 *   outbox/<id>.json   桥写：  {id, ok, reply, turn, tookMs, at, reason?}
 *   done/<id>.json     处理完的 inbox 原件（留档，出问题时能看原始请求）
 *   failed/<id>.json   处理失败的（带 error）
 *
 * 一次只处理一个（澜汐的规矩：同一时刻只许一条会话生成）。按文件名排序 = 按时间先后。
 */

import fs from 'node:fs'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function createPump({ baseDir, deliver, log = () => {}, pollMs = 400, onIdle = null }) {
  const D = {
    root: baseDir,
    inbox: path.join(baseDir, 'inbox'),
    outbox: path.join(baseDir, 'outbox'),
    done: path.join(baseDir, 'done'),
    failed: path.join(baseDir, 'failed'),
  }
  for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true })

  let stopped = false
  let busy = false
  let timer = null

  function atomicWrite(file, obj) {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  function listInbox() {
    try {
      return fs.readdirSync(D.inbox)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
        .sort()
    } catch { return [] }
  }

  async function handle(file) {
    const full = path.join(D.inbox, file)
    const id = path.basename(file, '.json')
    let job = null
    try {
      job = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (e) {
      fs.renameSync(full, path.join(D.failed, file))
      atomicWrite(path.join(D.outbox, `${id}.json`), { id, ok: false, reason: 'bad-json', at: Date.now() })
      return
    }

    const text = String(job.text ?? '').trim()
    if (!text) {
      fs.renameSync(full, path.join(D.failed, file))
      atomicWrite(path.join(D.outbox, `${id}.json`), { id, ok: false, reason: 'empty-text', at: Date.now() })
      return
    }

    const t0 = Date.now()
    let result
    try {
      result = await deliver({
        text,
        sessionId: job.sessionId,
        cwd: job.cwd,
        timeoutMs: job.timeoutMs,
      })
    } catch (e) {
      result = { ok: false, reason: 'exception', detail: String(e?.message ?? e) }
    }

    const out = { id, at: Date.now(), tookMs: Date.now() - t0, ...result }
    atomicWrite(path.join(D.outbox, `${id}.json`), out)
    try { fs.renameSync(full, path.join(D.done, file)) } catch { /* 外部可能已删 */ }
    log(`[pump] ${id} → ${out.ok ? 'ok' : (out.reason || 'fail')}  ${out.tookMs}ms  ${String(out.reply ?? '').slice(0, 60)}`)
  }

  async function tickOnce() {
    if (busy || stopped) return
    const files = listInbox()
    if (!files.length) { onIdle?.(); return }
    busy = true
    try {
      await handle(files[0])
    } catch (e) {
      log('[pump] 处理异常：' + (e?.message ?? e))
    } finally {
      busy = false
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => { tickOnce() }, pollMs)
    log(`[pump] 监听 ${D.inbox}（每 ${pollMs}ms 一次）`)
  }

  function stop() {
    stopped = true
    if (timer) { clearInterval(timer); timer = null }
  }

  return { start, stop, tickOnce, dirs: D, atomicWrite, busy: () => busy }
}
