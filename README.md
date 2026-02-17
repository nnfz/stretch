# Stretch

WebRTC стрим-плеер на Tauri + React.

## Требования

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri prerequisites](https://tauri.app/v2/guides/getting-started/prerequisites)

## Разработка

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

Собранный инсталлятор будет в `src-tauri/target/release/bundle/`.

## Миграция с Electron

Заменён `window.electron` на `tauriApi` из `src/tauriApi.js`:

| Electron                            | Tauri                              |
|-------------------------------------|------------------------------------|
| `window.electron.minimizeWindow()`  | `tauriApi.minimizeWindow()`        |
| `window.electron.maximizeWindow()`  | `tauriApi.maximizeWindow()`        |
| `window.electron.closeWindow()`     | `tauriApi.closeWindow()`           |
| `window.electron.downloadAndInstallUpdate(url)` | `tauriApi.downloadAndInstallUpdate(url)` |
| `window.electron.onUpdateProgress(cb)` | `tauriApi.onUpdateProgress(cb)` |
| `WebkitAppRegion: drag`             | `data-tauri-drag-region`           |
| `preload.js` + `contextBridge`      | `invoke()` + `listen()` из `@tauri-apps/api` |
