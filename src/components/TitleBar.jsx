import { useState, useEffect } from 'react';
import { HiMenuAlt2 } from 'react-icons/hi';
import { VscChromeMinimize, VscChromeMaximize, VscChromeRestore, VscChromeClose } from 'react-icons/vsc';
import './TitleBar.css';

function TitleBar({ onToggleSidebar }) {
  const [platform, setPlatform] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (window.electron) {
      setPlatform(window.electron.platform);
    }
  }, []);

  const handleMinimize = () => {
    window.electron?.minimizeWindow();
  };

  const handleMaximize = () => {
    setIsMaximized(!isMaximized);
    window.electron?.maximizeWindow();
  };

  const handleClose = () => {
    window.electron?.closeWindow();
  };
  
  return (
    <div className="titlebar" style={{ WebkitAppRegion: 'drag' }}>
      <div className="titlebar-drag-region" />
      <div className="titlebar-left" style={{ WebkitAppRegion: 'no-drag' }}>
        <button 
          className="sidebar-toggle-btn"
          onClick={onToggleSidebar}
          title="Переключить сайдбар"
        >
          <HiMenuAlt2 />
        </button>
        <span className="app-name">stretch</span>
      </div>

      <div 
        className="titlebar-controls windows"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <button className="titlebar-button win-minimize" onClick={handleMinimize} title="Свернуть">
          <VscChromeMinimize />
        </button>
        <button className="titlebar-button win-maximize" onClick={handleMaximize} title={isMaximized ? "Восстановить" : "Развернуть"}>
          {isMaximized ? <VscChromeRestore /> : <VscChromeMaximize />}
        </button>
        <button className="titlebar-button win-close" onClick={handleClose} title="Закрыть">
          <VscChromeClose />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
