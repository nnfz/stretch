import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const tauriApi = {
  minimizeWindow: () => invoke('minimize_window'),
  maximizeWindow: () => invoke('maximize_window'),
  closeWindow: () => invoke('close_window'),
  platform: 'windows',

  downloadAndInstallUpdate: async (url) => {
    return invoke('download_and_install_update', { url });
  },

  onUpdateProgress: (callback) => {
    listen('update-download-progress', (event) => {
      callback(event.payload);
    });
  },

  isMaximized: async () => {
    const win = getCurrentWindow();
    return win.isMaximized();
  },

  onMaximizeChange: async (callback) => {
    const win = getCurrentWindow();
    await win.listen('tauri://resize', async () => {
      const maximized = await win.isMaximized();
      callback(maximized);
    });
  },
};
