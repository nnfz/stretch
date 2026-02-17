const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  platform: process.platform,
  downloadAndInstallUpdate: (url) => ipcRenderer.invoke('download-and-install-update', url),
  onUpdateProgress: (callback) => ipcRenderer.on('update-download-progress', (_, progress) => callback(progress))
});
