# file-bus-bridge · 用文件夹当队列的进程间总线

> 给"跑在你进程外面、但想跟你的 agent 说一句话"的东西用。
> 不占端口、不要鉴权、不需要 Web 框架——两个进程之间只用几个 JSON 文件。

## 它解决什么问题

很多 agent 框架的 HTTP 接口只对**本机带会话凭据的请求**开放。你在外面跑的脚本去打，拿到的是 `401`：

```
GET /api/settings   → 401
GET /some-plugin/status → 401
```

但插件的功能明明在。于是换一条路：**用文件夹传话**。

```
你的进程  ──写──►  <baseDir>/inbox/<id>.json      （请求）
插件端    ──读──►  …调用 agent 干活…
插件端    ──写──►  <baseDir>/outbox/<id>.json     （回执）
你的进程  ──读──►  拿到 reply，删掉回执
```

## 两端是什么

| 半边 | 文件 | 干什么 |
|---|---|---|
| **客户端** | `bridge.mjs` → `createBridge(cfg)` | `deliver(text)`：投一条，等回执，超时有明确 `reason` |
| **服务端** | `pump.mjs` → `createPump({ baseDir, deliver })` | 轮询 inbox，把 job 交给你的 `deliver`，把结果写 outbox |

两边都是纯文件操作，**所以这个测试不需要 DSH、不需要端口、不需要凭据**：

```bash
node test.mjs
# ok   pump 收到 job → 写 outbox → client 拿得到
# ok   第一次 deliver 会自己建 inbox/outbox
# ok   超时要有明确 reason，不挂死
# ok   结果读完自动删，outbox 不积压
# ok   pump 交给投递端的 job 带 text 与 timeoutMs
# 5 passed, 0 failed
```

## 用它

### 客户端（在外面的进程里）

```js
import { createBridge } from './bridge.mjs'

const bridge = createBridge({
  bridge: { dshHome: '/path/to/your/app/data', timeoutMs: 180000, pollMs: 150 },
})

const r = await bridge.deliver('帮我看一眼这个报错')
if (r.ok) console.log(r.reply)
else console.log('没回：', r.reason)   // timeout / 具体错误
```

### 服务端（在宿主里）

```js
import { createPump } from './pump.mjs'

const pump = createPump({
  baseDir: '/path/to/your/app/data',
  pollMs: 400,
  deliver: async (job) => {
    // job.text 是要说的话；这里换成你自己的 agent 调用
    const reply = await myAgent.ask(job.text)
    return { ok: true, reply }
  },
})
pump.start()   // 记得在退出时 pump.stop()
```

## 协议（就这么点）

**请求** `<baseDir>/inbox/<id>.json`

```json
{ "id": "1793873538262-001", "text": "要传的话", "at": 1793873538262, "timeoutMs": 180000 }
```

**回执** `<baseDir>/outbox/<id>.json`

```json
{ "id": "1793873538262-001", "ok": true, "reply": "它说的话", "turn": 12, "tookMs": 1339 }
```

**约定**

- 写文件一律 `写 .tmp → rename`，别让对面读到半个文件
- 回执**读一次就删**，否则 outbox 会越积越多
- `id` 只要求"同一次运行内不重复"，时间戳 + 序号就够
- 两边都**不要**用带 BOM 的编码写 JSON（Windows 上 PowerShell 的 `Set-Content -Encoding UTF8` 会加 BOM，对面 `JSON.parse` 直接抛异常）

## 已知问题

- **单机**：目录共享就成立，跨机器请换成真正的队列（Redis / SQS）
- **没有重放保护**：如果客户端崩溃在"写完了、还没读回执"之间，那个 job 会留在 outbox 里没人取。生产里建议加个 TTL 清理（比如超过 1 小时的回执直接删）
- **没有优先级**：按文件名顺序处理。要优先级就在 `id` 前面加级别前缀，让 `pump` 排序

## 许可

MIT，见 [LICENSE](LICENSE)。

---

这套一共四个零件，索引在 [dsh-plugins](https://github.com/not-zai/dsh-plugins)：
**递话**（senses-bridge）· **记事**（memory-pipeline）· **自己开口**（self-nudge）· **先知道天气**（weather-watch）。
