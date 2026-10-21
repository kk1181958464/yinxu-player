import { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } from 'electron'
import { join } from 'path'
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

app.setAppUserModelId('com.gina.kugou-player')

app.whenReady().then(async () => {
  try {
    await startApiServer()
    console.log(`[main] KuGouMusicApi @ http://127.0.0.1:${API_PORT}`)
  } catch (err) {
    console.error('[main] API server failed to start:', err)
  }

  createWindow()
  createTray()

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
