const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn, exec } = require('child_process')
const fs = require('fs')

let mainWindow
let pythonProcess
let splashWindow

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.center()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a12',
      symbolColor: '#ffffff',
      height: 32
    },
    backgroundColor: '#0a0a12',
    frame: true
  })

  // 开发环境加载 Vite 服务器，生产环境加载打包文件
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close()
      splashWindow = null
    }
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function startPythonBackend() {
  return new Promise((resolve, reject) => {
    let pythonPath, args, cwd
    const backendPort = process.env.AI_STORYBOARDER_PORT || process.env.BACKEND_PORT || '8001'
    
    if (app.isPackaged) {
      // 打包后使用 PyInstaller 生成的 exe
      const exePath = path.join(process.resourcesPath, 'backend', 'backend-server.exe')
      if (fs.existsSync(exePath)) {
        pythonPath = exePath
        args = []
        cwd = path.join(process.resourcesPath, 'backend')
      } else {
        // 如果没有 exe，尝试使用 Python
        pythonPath = 'python'
        args = ['-m', 'uvicorn', 'main:app', '--port', backendPort]
        cwd = path.join(process.resourcesPath, 'backend')
      }
    } else {
      pythonPath = 'python'
      args = ['-m', 'uvicorn', 'main:app', '--port', backendPort]
      cwd = path.join(__dirname, '../backend')
    }

    console.log(`Starting backend: ${pythonPath} ${args.join(' ')}`)
    console.log(`Working directory: ${cwd}`)

    pythonProcess = spawn(pythonPath, args, { 
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString()
      console.log(`Backend: ${output}`)
      if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
        resolve()
      }
    })
    
    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString()
      console.log(`Backend: ${output}`)
      if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
        resolve()
      }
    })

    pythonProcess.on('error', (err) => {
      console.error('Failed to start backend:', err)
      reject(err)
    })

    // 超时后也继续
    setTimeout(resolve, 5000)
  })
}

function stopPythonBackend() {
  if (pythonProcess) {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pythonProcess.pid} /T /F`)
    } else {
      pythonProcess.kill('SIGTERM')
    }
    pythonProcess = null
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  createSplashWindow()
  
  try {
    await startPythonBackend()
  } catch (err) {
    console.error('Backend start failed:', err)
  }
  
  createWindow()
})

app.on('window-all-closed', () => {
  stopPythonBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopPythonBackend()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC 处理
ipcMain.handle('select-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
  })
  return result.filePaths[0]
})

ipcMain.handle('save-file', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: options?.defaultPath,
    filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
  })
  return result.filePath
})

ipcMain.handle('get-system-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }
})

ipcMain.handle('open-project', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Project Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePaths?.[0]) return null
    const filePath = result.filePaths[0]
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    console.error('open-project failed:', err)
    return null
  }
})

ipcMain.handle('save-project', async (event, data) => {
  try {
    const defaultName = (() => {
      const raw = (data && typeof data === 'object' && data.name) ? String(data.name) : 'project'
      const safe = raw.replace(/[\\/:*?"<>|]+/g, '_').trim()
      return safe || 'project'
    })()

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${defaultName}.json`,
      filters: [
        { name: 'Project Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) return false
    const payload = typeof data === 'string' ? data : JSON.stringify(data ?? null, null, 2)
    fs.writeFileSync(result.filePath, payload, 'utf-8')
    return true
  } catch (err) {
    console.error('save-project failed:', err)
    return false
  }
})
