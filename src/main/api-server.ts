import { join } from 'path'
import { app } from 'electron'
import http from 'http'
import { existsSync } from 'fs'

export const API_PORT = Number(process.env.KUGOU_API_PORT || 3678)

interface ApiService {
  service?: {
    close: (callback?: (err?: Error) => void) => void
  }
}

let inProcessService: ApiService | null = null

function serverRoot(): string {
  const candidates = [
    ...(app.isPackaged ? [join(process.resourcesPath, 'server')] : []),
    join(app.getAppPath(), 'server'),
    join(app.getAppPath(), '..', 'server'),
    join(__dirname, '../../server'),
    join(process.cwd(), 'server')
  ]
  for (const p of candidates) {
    if (existsSync(join(p, 'app.js'))) return p
  }
  return candidates[0]
}

function waitForPort(port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`API 未在 ${timeoutMs}ms 内启动 (port ${port})`))
        } else {
          setTimeout(tryOnce, 300)
        }
      })
      req.setTimeout(800, () => {
        req.destroy()
      })
    }
    tryOnce()
  })
}

/**
 * 直接在主进程里启动 Express，而不是再 spawn 一个同名的 音序.exe。
 * 这样安装/更新时 NSIS 只会检测到主程序一个进程，不会因为隐藏的
 * API 子进程没有窗口而提示“无法关闭”。
 */
export async function startApiServer(): Promise<void> {
  if (inProcessService) return

  const cwd = serverRoot()
  const entry = join(cwd, 'server.js')
  console.log('[api-server] root =', cwd)

  try {
    await waitForPort(API_PORT, 800)
    console.log('[api-server] 已有本地服务，跳过拉起')
    return
  } catch {
    // continue
  }

  if (!existsSync(entry)) {
    throw new Error(`找不到 API 入口: ${entry}`)
  }

  process.env.PORT = String(API_PORT)
  process.env.HOST = '127.0.0.1'
  process.env.platform = process.env.platform || 'lite'

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serverModule = require(entry) as {
    startService: () => Promise<ApiService>
  }
  inProcessService = await serverModule.startService()
  await waitForPort(API_PORT)
}

export function stopApiServer(): void {
  const service = inProcessService?.service
  inProcessService = null
  if (!service) return
  try {
    service.close()
  } catch {
    // ignore
  }
}
