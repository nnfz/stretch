const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, 'src', 'icon', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 670,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    frame: false,
    titleBarStyle: 'hidden',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('close-window', () => {
  mainWindow?.close();
});

ipcMain.handle('download-and-install-update', async (event, url) => {
  const tempPath = path.join(app.getPath('temp'), 'stretch-update.exe');

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);

    const download = (downloadUrl) => {
      const client = downloadUrl.startsWith('https') ? https : http;

      client.get(downloadUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          download(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize) {
            const progress = Math.round((downloaded / totalSize) * 100);
            if (mainWindow) {
              mainWindow.webContents.send('update-download-progress', progress);
              mainWindow.setProgressBar(progress / 100);
            }
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          if (mainWindow) mainWindow.setProgressBar(-1);

          spawn(tempPath, ['/S', '--updated'], {
            detached: true,
            stdio: 'ignore'
          }).unref();

          setTimeout(() => {
            app.quit();
          }, 500);

          resolve(true);
        });

        file.on('error', (err) => {
          fs.unlink(tempPath, () => {});
          if (mainWindow) mainWindow.setProgressBar(-1);
          reject(err);
        });

      }).on('error', (err) => {
        fs.unlink(tempPath, () => {});
        if (mainWindow) mainWindow.setProgressBar(-1);
        reject(err);
      });
    };

    download(url);
  });
});