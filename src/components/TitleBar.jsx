import { useState, useEffect } from 'react';
import { HiMenuAlt2 } from 'react-icons/hi';
import { VscChromeMinimize, VscChromeMaximize, VscChromeRestore, VscChromeClose } from 'react-icons/vsc';
import { tauriApi } from '../tauriApi';
import './TitleBar.css';

function TitleBar({ onToggleSidebar }) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    tauriApi.isMaximized().then(setIsMaximized).catch(() => {});
    tauriApi.onMaximizeChange(setIsMaximized).catch(() => {});
  }, []);

  const handleMinimize = () => {
    tauriApi.minimizeWindow();
  };

  const handleMaximize = () => {
    tauriApi.maximizeWindow();
  };

  const handleClose = () => {
    tauriApi.closeWindow();
  };

  return (
    <div className="titlebar" style={{ WebkitAppRegion: 'drag' }}>
      <div className="titlebar-left">
        <button
          className="sidebar-toggle-btn"
          style={{ WebkitAppRegion: 'no-drag' }}
          onClick={onToggleSidebar}
          title="Переключить сайдбар"
        >
          <HiMenuAlt2 />
        </button>
        <span className="app-name">stretch</span>
      </div>

      <div className="titlebar-controls windows">
        <button className="titlebar-button win-minimize" style={{ WebkitAppRegion: 'no-drag' }} onClick={handleMinimize} title="Свернуть">
          <VscChromeMinimize />
        </button>
        <button className="titlebar-button win-maximize" style={{ WebkitAppRegion: 'no-drag' }} onClick={handleMaximize} title={isMaximized ? 'Восстановить' : 'Развернуть'}>
          {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
        </button>
        <button className="titlebar-button win-close" style={{ WebkitAppRegion: 'no-drag' }} onClick={handleClose} title="Закрыть">
          <VscChromeClose />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
