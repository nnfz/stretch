import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HiX, HiCheck, HiDownload } from 'react-icons/hi';
import { tauriApi } from '../tauriApi';
import './Settings.css';

function Settings({ onClose }) {
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem('serverUrl') || 'https://stream.nnfz.ru';
  });

  const [autoUpdate, setAutoUpdate] = useState(() => {
    const saved = localStorage.getItem('autoUpdate');
    return saved !== null ? saved === 'true' : true;
  });

  const [showFullStats, setShowFullStats] = useState(() => {
    const saved = localStorage.getItem('showFullStats');
    return saved !== null ? saved === 'true' : false;
  });

  const [updateStatus, setUpdateStatus] = useState('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    const version = import.meta.env.APP_VERSION || '1.0.0';
    setCurrentVersion(version);

    tauriApi.onUpdateProgress((progress) => {
      setDownloadProgress(progress);
    });
  }, []);

  const handleToggleFullStats = (checked) => {
    setShowFullStats(checked);
    localStorage.setItem('showFullStats', checked.toString());
    window.dispatchEvent(new CustomEvent('settingsChanged', {
      detail: { showFullStats: checked }
    }));
  };

  const compareVersions = (v1, v2) => {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  };

  const checkForUpdates = async () => {
    try {
      setUpdateStatus('checking');
      const currentVer = import.meta.env.APP_VERSION || '1.0.0';
      const response = await fetch('https://api.github.com/repos/nnfz/stretch/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      const latestVer = data.tag_name.replace('v', '');
      setLatestVersion(latestVer);
      const asset = data.assets.find(a => a.name.endsWith('.exe'));
      if (asset) setDownloadUrl(asset.browser_download_url);
      if (compareVersions(currentVer, latestVer) < 0) {
        setUpdateStatus('available');
      } else {
        setUpdateStatus('latest');
      }
    } catch (error) {
      console.error('Update check failed:', error);
      setUpdateStatus('error');
    }
  };

  const handleSave = () => {
    const oldServer = localStorage.getItem('serverUrl');
    localStorage.setItem('serverUrl', serverUrl);
    localStorage.setItem('autoUpdate', autoUpdate.toString());
    localStorage.setItem('showFullStats', showFullStats.toString());

    if (oldServer !== serverUrl) {
      onClose();
      window.location.reload();
    } else {
      onClose();
    }
  };

  const handleDownloadUpdate = async () => {
    if (!downloadUrl) return;
    try {
      setUpdateStatus('downloading');
      setDownloadProgress(0);
      await tauriApi.downloadAndInstallUpdate(downloadUrl);
    } catch (error) {
      console.error('Update failed:', error);
      setUpdateStatus('error');
    }
  };

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal settings-modal"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Настройки</h2>
          <button className="close-btn" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>Сервер потока</label>
            <input
              type="text"
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder="https://stream.nnfz.ru"
            />
            <p className="hint">URL сервера для получения WebRTC потока</p>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showFullStats}
                onChange={e => handleToggleFullStats(e.target.checked)}
              />
              <span>Расширенная диагностика</span>
            </label>
            <p className="hint">Показывать джиттер, битрейт, FPS, буфер и другие данные</p>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={e => setAutoUpdate(e.target.checked)}
              />
              <span>Автоматически проверять обновления</span>
            </label>
            <p className="hint">Проверка новых версий каждые 5 часов</p>
          </div>

          <div className="form-group update-group">
            <label>Обновления</label>
            <div className="update-info">
              <div className="version-row">
                <span className="version-label">Текущая версия:</span>
                <span className="version-value mono">v{currentVersion}</span>
              </div>
              {updateStatus === 'checking' && (
                <div className="update-status checking">Проверка обновлений...</div>
              )}
              {updateStatus === 'latest' && (
                <div className="update-status latest">
                  <HiCheck /> Установлена последняя версия
                </div>
              )}
              {updateStatus === 'available' && (
                <div className="update-available">
                  <div className="update-status available">
                    Доступна новая версия: v{latestVersion}
                  </div>
                  <button className="btn-download" onClick={handleDownloadUpdate}>
                    <HiDownload /> Установить обновление
                  </button>
                </div>
              )}
              {updateStatus === 'downloading' && (
                <div className="update-downloading">
                  <div className="update-status downloading">
                    Скачивание обновления... {downloadProgress}%
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="hint">Приложение перезапустится автоматически</p>
                </div>
              )}
              {updateStatus === 'error' && (
                <div className="update-status error">
                  Не удалось проверить/скачать обновление
                </div>
              )}
            </div>
            <button
              className="btn-check"
              onClick={checkForUpdates}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
            >
              Проверить обновления
            </button>
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Отмена</button>
            <button className="btn-primary" onClick={handleSave}>
              <HiCheck /> Сохранить
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Settings;
