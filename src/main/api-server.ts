import { spawn, ChildProcess, execSync } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import http from 'http'
import { existsSync } from 'fs'

export const API_PORT = Number(process.env.KUGOU_API_PORT || 3678)

let child: ChildProcess | null = null

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

export async function startApiServer(): Promise<void> {
  if (child && !child.killed) return

  const cwd = serverRoot()
  const entry = join(cwd, 'app.js')
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

  child = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      platform: process.env.platform || 'lite'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  child.stdout?.on('data', (d) => console.log(`[api] ${String(d).trim()}`))
  child.stderr?.on('data', (d) => console.error(`[api] ${String(d).trim()}`))
  child.on('exit', (code) => {
    console.log(`[api-server] exited: ${code}`)
    child = null
  })

  await waitForPort(API_PORT)
}

export function stopApiServer(): void {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
      } catch {
        child.kill()
      }
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // ignore
  }
  child = null
}