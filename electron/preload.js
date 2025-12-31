const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  
  // 项目管理
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: (data) => ipcRenderer.invoke('save-project', data),
  
  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info')
})
