import { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
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

function sendUpdaterStatus(payload: Record<string, unknown>): void {
  mainWindow?.webContents.send('updater-status', payload)
}

function setupUpdater(): void {
  if (updaterStarted) return
  updaterStarted = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  // Windows 包目前不带代码签名，关闭发布者签名校验，避免无法安装更新。
  ;(autoUpdater as unknown as { verifyUpdateCodeSignature: boolean }).verifyUpdateCodeSignature =
    false

  autoUpdater.on('checking-for-update', () => sendUpdaterStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    sendUpdaterStatus({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', (info) =>
    sendUpdaterStatus({ state: 'not-available', version: info.version })
  )
  autoUpdater.on('download-progress', (progress) =>
    sendUpdaterStatus({
      state: 'downloading',
      percent: Math.round(progress.percent || 0)
    })
  )
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdaterStatus({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) =>
    sendUpdaterStatus({ state: 'error', message: error.message || '检查更新失败' })
  )

  if (!app.isPackaged) return

  // 启动后静默检查一次，之后每 6 小时检查一次。
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => {
      sendUpdaterStatus({
        state: 'error',
        message: error instanceof Error ? error.message : '检查更新失败'
      })
    })
  }, 8000)
  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch(() => {
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
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '检查更新失败'
    sendUpdaterStatus({ state: 'error', message })
    return { state: 'error', message }
  }
})

ipcMain.handle('updater-download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载更新失败'
    sendUpdaterStatus({ state: 'error', message })
    return { state: 'error', message }
  }
})

ipcMain.handle('updater-install', () => {
  // 让 IPC 返回后主进程再退出，避免渲染进程连接被提前断开。
  setTimeout(() => autoUpdater.quitAndInstall(), 100)
  return true
})
