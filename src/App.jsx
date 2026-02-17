import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Player from './components/Player';
import AddStreamModal from './components/AddStreamModal';
import Settings from './components/Settings';
import useUpdateChecker from './hooks/useUpdateChecker';
import { tauriApi } from './tauriApi';
import './App.css';

const SIDEBAR_BREAKPOINT = 1030;

function App() {
  const [streams, setStreams] = useState(() => {
    const saved = localStorage.getItem('streams');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeStreamId, setActiveStreamId] = useState(() => {
    const saved = localStorage.getItem('activeStreamId');
    return saved || null;
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => {
    return window.innerWidth >= SIDEBAR_BREAKPOINT;
  });
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const { hasUpdate, updateInfo } = useUpdateChecker();

  useEffect(() => {
    let prevWidth = window.innerWidth;

    const handleResize = () => {
      const currentWidth = window.innerWidth;

      if (currentWidth < SIDEBAR_BREAKPOINT) {
        setIsSidebarVisible(false);
      } else if (prevWidth < SIDEBAR_BREAKPOINT && currentWidth >= SIDEBAR_BREAKPOINT) {
        if (!manuallyHidden) {
          setIsSidebarVisible(true);
        }
      }

      prevWidth = currentWidth;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [manuallyHidden]);

  const saveStreams = useCallback((newStreams) => {
    setStreams(newStreams);
    localStorage.setItem('streams', JSON.stringify(newStreams));
  }, []);

  const addStream = useCallback((streamKey, name) => {
    const newStream = {
      id: Date.now().toString(),
      key: streamKey,
      name: name || streamKey,
      addedAt: Date.now(),
    };
    const newStreams = [...streams, newStream];
    saveStreams(newStreams);
    setActiveStreamId(newStream.id);
    localStorage.setItem('activeStreamId', newStream.id);
  }, [streams, saveStreams]);

  const removeStream = useCallback((id) => {
    const newStreams = streams.filter(s => s.id !== id);
    saveStreams(newStreams);

    if (activeStreamId === id) {
      const newActive = newStreams[0]?.id || null;
      setActiveStreamId(newActive);
      if (newActive) {
        localStorage.setItem('activeStreamId', newActive);
      } else {
        localStorage.removeItem('activeStreamId');
      }
    }
  }, [streams, activeStreamId, saveStreams]);

  const setActive = useCallback((id) => {
    setActiveStreamId(id);
    localStorage.setItem('activeStreamId', id);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible(prev => {
      const next = !prev;
      if (!next && window.innerWidth >= SIDEBAR_BREAKPOINT) {
        setManuallyHidden(true);
      }
      if (next) {
        setManuallyHidden(false);
      }
      return next;
    });
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl || isUpdating) return;
    setIsUpdating(true);
    try {
      await tauriApi.downloadAndInstallUpdate(updateInfo.downloadUrl);
    } catch (e) {
      setIsUpdating(false);
    }
  }, [updateInfo, isUpdating]);

  const activeStream = streams.find(s => s.id === activeStreamId);

  return (
    <div className="app">
      <TitleBar onToggleSidebar={toggleSidebar} />
      <div className="app-body">
        <AnimatePresence initial={false}>
          {isSidebarVisible && (
            <motion.div
              initial={{ x: -280, width: 0, opacity: 0 }}
              animate={{ x: 0, width: 280, opacity: 1 }}
              exit={{ x: -280, width: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              style={{ overflow: 'hidden', height: '100%', display: 'flex', flexShrink: 0 }}
            >
              <Sidebar
                streams={streams}
                activeStreamId={activeStreamId}
                onStreamSelect={setActive}
                onStreamRemove={removeStream}
                onAddStream={() => setShowAddModal(true)}
                onOpenSettings={() => setShowSettings(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <main className="main-content">
          {activeStream ? (
            <Player key={activeStream.id} stream={activeStream} />
          ) : (
            <div className="empty-state">
              <div className="main-text">
                <h2>Нет активных стримов</h2>
                <p>Добавьте стрим чтобы начать просмотр</p>
              </div>
              <button
                className="btn-add"
                onClick={() => setShowAddModal(true)}
              >
                Добавить стрим
              </button>
            </div>
          )}
        </main>
      </div>
      <AnimatePresence>
        {showAddModal && (
          <AddStreamModal
            onClose={() => setShowAddModal(false)}
            onAdd={addStream}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSettings && (
          <Settings onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {hasUpdate && updateInfo && (
          <motion.div
            className="update-notification"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            <div className="update-content">
              <span className="update-text">
                Доступна новая версия v{updateInfo.version}
              </span>
              <button
                className="update-download-btn"
                onClick={handleInstallUpdate}
                disabled={isUpdating}
              >
                {isUpdating ? 'Скачивание...' : 'Установить'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
