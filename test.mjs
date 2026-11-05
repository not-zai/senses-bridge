/**
 * test.mjs —— 文件总线的自测：client（bridge.mjs）↔ pump（pump.mjs）两端能不能对上。
 *
 * 两端都是纯文件操作，所以这个测试**不需要 DSH、不需要端口、不需要凭据**：
 *   起一个假 pump（收到 inbox 就写 outbox），用 createBridge 投一条，看能不能拿到回执。
 *
 * 跑：node test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBridge } from './bridge.mjs'
import { createPump } from './pump.mjs'

const TMP = path.join(os.tmpdir(), 'file-bus-test-' + Date.now())
const results = []
const t = async (name, fn) => {
  try { await fn(); results.push(['ok  ', name]) } catch (e) { results.push(['FAIL', name, e.message]) }
}

const cfg = { bridge: { dshHome: TMP, timeoutMs: 3000, pollMs: 60 } }
const bridge = createBridge(cfg)

await t('pump 收到 job → 写 outbox → client 拿得到', async () => {
  const { root } = bridge.dirs
  const pump = createPump({
    baseDir: root,
    pollMs: 40,
    deliver: async (job) => ({ ok: true, reply: '收到：' + job.text, turn: 1 }),
  })
  pump.start()
  const r = await bridge.deliver('你好')
  pump.stop()
  assert.equal(r.ok, true, '没拿到回执：' + JSON.stringify(r))
  assert.equal(r.reply, '收到：你好')
})

await t('第一次 deliver 会自己建 inbox/outbox', async () => {
  const { inbox, outbox } = bridge.dirs
  assert.ok(fs.existsSync(inbox), 'inbox 没建')
  assert.ok(fs.existsSync(outbox), 'outbox 没建')
})

await t('超时要有明确 reason，不挂死', async () => {
  const dead = createBridge({ bridge: { dshHome: TMP, timeoutMs: 300, pollMs: 40 } })
  const r = await dead.deliver('没人接')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'timeout')
})

await t('结果读完自动删，outbox 不积压', async () => {
  const { outbox } = bridge.dirs
  const left = fs.readdirSync(outbox)
  assert.equal(left.length, 0, 'outbox 里还剩 ' + left.join(','))
})

await t('pump 交给投递端的 job 带 text 与 timeoutMs', async () => {
  const { root } = bridge.dirs
  let seen = null
  const pump = createPump({ baseDir: root, pollMs: 40, deliver: async (job) => { seen = job; return { ok: true, reply: 'ok' } } })
  pump.start()
  await bridge.deliver('结构检查')
  pump.stop()
  assert.ok(seen, 'pump 没收到 job')
  assert.equal(seen.text, '结构检查')
  assert.ok(Number(seen.timeoutMs) > 0, 'timeoutMs 没传过去')
})

for (const r of results) console.log(r[0], r[1], r[2] ? '→ ' + r[2] : '')
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
process.exit(failed ? 1 : 0)
