import { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'
import { startApiServer, stopApiServer, API_PORT } from './api-server'

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', name)
    : join(__dirname, '../../resources', name)
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  if (tray) return
  try {
    const image = nativeImage.createFromPath(resourcePath('tray.png'))
    if (image.isEmpty()) return
    tray = new Tray(image.resize({ width: 32, height: 32 }))
    tray.setToolTip('音序')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示音序', click: showMainWindow },
        { type: 'separator' },
        { label: '退出音序', click: () => app.quit() }
      ])
    )
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
  } catch (err) {
    console.warn('[main] tray unavailable:', err)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    title: '音序',
    icon: resourcePath('icon.png'),
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 先把窗口画出来，再启动本地 API；渲染端会短暂重试等待 API 就绪。
    setTimeout(ensureApiServer, 80)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let apiStartRequested = false

function ensureApiServer(): void {
  if (apiStartRequested) return
  apiStartRequested = true
  void startApiServer()
    .then(() => console.log(`[main] KuGouMusicApi @ http://127.0.0.1:${API_PORT}`))
    .catch((err) => console.error('[main] API server failed to start:', err))
}

let updaterStarted = false

const UPDATE_API =
  'https://api.github.com/repos/kk1181958464/yinxu-player/releases/latest'
const UPDATE_UA = 'Yinxu-Windows-Updater'

interface ZippedUpdate {
  version: string
  url: string
  kind: 'app' | 'win'
  zipPath?: string
}

let pendingUpdate: ZippedUpdate | null = null

function sendUpdaterStatus(payload: Record<string, unknown>): void {
  mainWindow?.webContents.send('updater-status', payload)
}

function parseVersion(value: string): number[] {
  return String(value)
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function requestUrl(url: string, redirects = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': UPDATE_UA } }, (response) => {
      const location = response.headers.location
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        location &&
        redirects > 0
      ) {
        response.resume()
        resolve(requestUrl(new URL(location, url).toString(), redirects - 1))
        return
      }
      resolve(response)
    }).on('error', reject)
  })
}

async function requestJson(url: string): Promise<Record<string, unknown>> {
  const response = await requestUrl(url)
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`GitHub 返回 ${response.statusCode}`)
  }
  let raw = ''
  for await (const chunk of response) raw += chunk
  return JSON.parse(raw) as Record<string, unknown>
}

async function findLatestUpdate(): Promise<ZippedUpdate | null> {
  const release = await requestJson(UPDATE_API)
  const assets = Array.isArray(release.assets)
    ? (release.assets as Array<Record<string, unknown>>)
    : []
  let fullPackage: ZippedUpdate | null = null
  for (const asset of assets) {
    const name = String(asset.name || '')
    const match = name.match(/^Yinxu-(\d+\.\d+\.\d+)-(app|win)\.zip$/i)
    if (!match) continue
    const url = String(asset.browser_download_url || '')
    if (!url) continue
    const candidate: ZippedUpdate = {
      version: match[1],
      url,
      kind: match[2].toLowerCase() === 'app' ? 'app' : 'win'
    }
    // app.zip 只包含 app.asar，体积约为完整包的四分之一，优先下载。
    if (candidate.kind === 'app') return candidate
    fullPackage = candidate
  }
  return fullPackage
}

async function checkForUpdates(): Promise<{ ok: boolean }> {
  sendUpdaterStatus({ state: 'checking' })
  const latest = await findLatestUpdate()
  if (!latest) {
    sendUpdaterStatus({ state: 'not-available', version: app.getVersion() })
    return { ok: true }
  }
  pendingUpdate = latest
  if (compareVersions(latest.version, app.getVersion()) > 0) {
    sendUpdaterStatus({ state: 'available', version: latest.version })
  } else {
    sendUpdaterStatus({ state: 'not-available', version: latest.version })
  }
  return { ok: true }
}

async function downloadUpdate(): Promise<void> {
  if (!pendingUpdate) throw new Error('请先检查更新')
  const dir = join(app.getPath('temp'), 'yinxu-update')
  mkdirSync(dir, { recursive: true })
  const zipPath = join(dir, `Yinxu-${pendingUpdate.version}-${pendingUpdate.kind}.zip`)
  if (existsSync(zipPath)) rmSync(zipPath, { force: true })

  sendUpdaterStatus({ state: 'downloading', percent: 0 })
  const response = await requestUrl(pendingUpdate.url)
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`下载更新失败（HTTP ${response.statusCode}）`)
  }
  const total = Number(response.headers['content-length'] || 0)
  let received = 0
  let lastPercent = -1
  const output = createWriteStream(zipPath)
  response.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) {
      const percent = Math.min(100, Math.round((received / total) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        sendUpdaterStatus({ state: 'downloading', percent })
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    response.pipe(output)
    output.on('finish', () => output.close(() => resolve()))
    output.on('error', reject)
    response.on('error', reject)
  })

  if (!existsSync(zipPath)) throw new Error('更新包下载失败')
  pendingUpdate.zipPath = zipPath
  sendUpdaterStatus({ state: 'downloaded', version: pendingUpdate.version })
}

function powerShellQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function installUpdate(): void {
  if (!pendingUpdate?.zipPath) throw new Error('更新包尚未下载完成')
  const version = pendingUpdate.version
  const unpackDir = join(app.getPath('temp'), 'yinxu-update', `unpacked-${version}`)
  if (existsSync(unpackDir)) rmSync(unpackDir, { recursive: true, force: true })
  mkdirSync(unpackDir, { recursive: true })
  new AdmZip(pendingUpdate.zipPath).extractAllTo(unpackDir, true)

  const appAsar = join(unpackDir, 'app.asar')
  const fullExe = join(unpackDir, '音序.exe')
  const installDir = dirname(app.getPath('exe'))
  const exe = powerShellQuote(join(installDir, '音序.exe'))
  let script: string

  if (existsSync(appAsar)) {
    // 轻量更新包只替换 app.asar，避免每次下载整个 Electron 运行时。
    const source = powerShellQuote(appAsar)
    const destination = powerShellQuote(join(installDir, 'resources', 'app.asar'))
    script = [
      'Start-Sleep -Milliseconds 1200',
      `Copy-Item -Path '${source}' -Destination '${destination}' -Force`,
      `Start-Process -FilePath '${exe}'`
    ].join('\r\n')
  } else if (existsSync(fullExe)) {
    const source = powerShellQuote(unpackDir)
    const destination = powerShellQuote(installDir)
    script = [
      'Start-Sleep -Milliseconds 1200',
      `Copy-Item -Path (Join-Path '${source}' '*') -Destination '${destination}' -Recurse -Force`,
      `Start-Process -FilePath '${exe}'`
    ].join('\r\n')
  } else {
    throw new Error('更新包内容不完整')
  }

  const scriptPath = join(app.getPath('temp'), 'yinxu-update', `apply-${version}.ps1`)
  writeFileSync(scriptPath, `\ufeff${script}`, 'utf8')

  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  }).unref()

  setTimeout(() => app.quit(), 300)
}

function setupUpdater(): void {
  if (updaterStarted) return
  updaterStarted = true
  if (!app.isPackaged) return

  // 启动后静默检查一次，之后每 6 小时检查一次。
  setTimeout(() => {
    void checkForUpdates().catch((error) => {
      sendUpdaterStatus({
        state: 'error',
        message: error instanceof Error ? error.message : '检查更新失败'
      })
    })
  }, 8000)
  setInterval(
    () => {
      void checkForUpdates().catch(() => {
        /* 静默检查失败不打扰用户 */
      })
    },
    6 * 60 * 60 * 1000
  )
}

app.setAppUserModelId('com.gina.kugou-player')

app.whenReady().then(() => {
  createWindow()
  createTray()
  setupUpdater()
  // 兜底：如果 ready-to-show 没有触发，也不能让 API 永远不启动。
  setTimeout(ensureApiServer, 1500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopApiServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  tray?.destroy()
  tray = null
  stopApiServer()
})

ipcMain.handle('get-api-base', () => `http://127.0.0.1:${API_PORT}`)

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})

ipcMain.handle('window-close', () => {
  mainWindow?.close()
})

ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('updater-version', () => app.getVersion())

ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged) {
    return { state: 'error', message: '开发模式不检查更新，请使用安装包' }
  }
  try {
    await checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '检查更新失败'
    sendUpdaterStatus({ state: 'error', message })
    return { state: 'error', message }
  }
})

ipcMain.handle('updater-download', async () => {
  try {
    await downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载更新失败'
    sendUpdaterStatus({ state: 'error', message })
    return { state: 'error', message }
  }
})

ipcMain.handle('updater-install', () => {
  try {
    installUpdate()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '安装更新失败'
    sendUpdaterStatus({ state: 'error', message })
    return { state: 'error', message }
  }
})
