/**
 * check-bridge.mjs — 重启 DSH 之后验桥。
 *
 * 注意：**不走 HTTP**。实测外部进程打任何插件路由都是 401（缺 loopback cookie），
 * 所以这里验的是文件总线：inbox/outbox 目录在不在、投一句能不能拿回话。
 *
 *   node tools/check-bridge.mjs            只看目录与配置（不打扰她）
 *   node tools/check-bridge.mjs --deliver  真投一句自检话
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, homeDir } from '../src/util.mjs'
import { createBridge } from '../src/bridge.mjs'

const cfg = loadConfig()
const bridge = createBridge(cfg)
const root = bridge.dirs.root
const DELIVER = process.argv.includes('--deliver')
const T_IDX = process.argv.indexOf('--timeout')
const TIMEOUT = T_IDX >= 0 ? Number(process.argv[T_IDX + 1]) : cfg.bridge.timeoutMs

console.log('桥目录:', root)
const need = ['inbox', 'outbox']
let ok = true
for (const d of need) {
  const p = path.join(root, d)
  const exists = fs.existsSync(p)
  console.log(`  ${exists ? '✓' : '✗'} ${d}`)
  if (!exists) ok = false
}

const cfgFile = path.join(cfg.bridge.dshHome, 'senses-bridge.json')
if (fs.existsSync(cfgFile)) {
  console.log('  目标会话配置:', fs.readFileSync(cfgFile, 'utf8').replace(/\s+/g, ' '))
} else {
  console.log('  （没有 senses-bridge.json：桥端会用内置默认会话，建议显式配一份）')
}

if (!ok) {
  console.log('\n✗ 目录不齐：桥没挂上。查三件：① 重启过 DSH 没有 ② node_modules 里 dsh-senses-bridge 的 junction 在不在 ③ cordis.patch.yml 的 insert 有没有写进去')
  process.exit(1)
}

console.log('\n✓ 目录在，桥已经跑起来了')

if (!DELIVER) {
  console.log('（只读检查完成。要真投递一句：加 --deliver）')
  process.exit(0)
}

console.log('\n→ 投递自检话（会在 LanXi 会话里留一条）')
const t0 = Date.now()
const r = await bridge.deliver('【自检】这是岸的桥测试：看到这条，回一个「在」就好，不用做别的事。', {
  timeoutMs: TIMEOUT,
})
console.log(`耗时 ${Date.now() - t0}ms`)
console.log(JSON.stringify(r, null, 2))
process.exit(r.ok ? 0 : 1)
