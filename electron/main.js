const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let mainWindow
let pythonProcess

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    frame: true
  })

  // 开发环境加载 Vite 服务器，生产环境加载打包文件
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function startPythonBackend() {
  const pythonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'main.exe')
    : 'python'
  
  const args = app.isPackaged
    ? []
    : ['-m', 'uvicorn', 'main:app', '--port', '8000']
  
  const cwd = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '../backend')

  pythonProcess = spawn(pythonPath, args, { cwd })
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python: ${data}`)
  })
  
  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python Error: ${data}`)
  })
}

app.whenReady().then(() => {
  createWindow()
  // startPythonBackend() // 开发时可手动启动后端
})

app.on('window-all-closed', () => {
  if (pythonProcess) pythonProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
