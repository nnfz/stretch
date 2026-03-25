import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HiX } from 'react-icons/hi';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Player from './components/Player';
import AddStreamModal from './components/AddStreamModal';
import Settings from './components/Settings';
import useUpdateChecker from './hooks/useUpdateChecker';
import { useAppFocus } from './hooks/AppFocusContext';
import { tauriApi } from './tauriApi';
import './App.css';

const SIDEBAR_BREAKPOINT = 1030;

function App() {
  const [streams, setStreams] = useState(() => {
    const saved = localStorage.getItem('streams');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [activeStreamIds, setActiveStreamIds] = useState(() => {
    try {
      const saved = localStorage.getItem('activeStreamIds');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    const legacy = localStorage.getItem('activeStreamId');
    return legacy ? [legacy] : [];
  });

  const [focusedStreamId, setFocusedStreamId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => {
    return window.innerWidth >= SIDEBAR_BREAKPOINT;
  });
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const { hasUpdate, updateInfo } = useUpdateChecker();
  const appFocused = useAppFocus();

  useEffect(() => {
    document.documentElement.classList.toggle('app-blurred', !appFocused);
  }, [appFocused]);

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
    setActiveStreamIds([newStream.id]);
    setFocusedStreamId(null);
  }, [streams, saveStreams]);

  const removeStream = useCallback((id) => {
    const newStreams = streams.filter(s => s.id !== id);
    saveStreams(newStreams);

    if (activeStreamIds.includes(id)) {
      const newActiveIds = activeStreamIds.filter(aid => aid !== id);
      if (newActiveIds.length === 0 && newStreams.length > 0) {
        setActiveStreamIds([newStreams[0].id]);
      } else {
        setActiveStreamIds(newActiveIds);
      }
      if (focusedStreamId === id) setFocusedStreamId(null);
    }
  }, [streams, activeStreamIds, focusedStreamId, saveStreams]);

  const setActive = useCallback((id, ctrlKey) => {
    if (ctrlKey) {
      if (activeStreamIds.includes(id)) {
        const newIds = activeStreamIds.filter(aid => aid !== id);
        setActiveStreamIds(newIds);
        if (focusedStreamId === id) setFocusedStreamId(null);
      } else {
        if (activeStreamIds.length < 4) {
          setActiveStreamIds(prev => [...prev, id]);
        } else {
          setActiveStreamIds(prev => [...prev.slice(0, 3), id]);
        }
        setFocusedStreamId(null);
      }
    } else {
      setActiveStreamIds([id]);
      setFocusedStreamId(null);
    }
  }, [activeStreamIds, focusedStreamId]);

  const handlePlayerClick = useCallback((streamId) => {
    if (activeStreamIds.length < 2) return;
    if (focusedStreamId === streamId) {
      setFocusedStreamId(null);
    } else {
      setFocusedStreamId(streamId);
    }
  }, [activeStreamIds.length, focusedStreamId]);

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
    } catch {
      setIsUpdating(false);
    }
  }, [updateInfo, isUpdating]);

  useEffect(() => {
    localStorage.setItem('activeStreamIds', JSON.stringify(activeStreamIds));
    if (activeStreamIds.length > 0) {
      localStorage.setItem('activeStreamId', activeStreamIds[0]);
    } else {
      localStorage.removeItem('activeStreamId');
    }
  }, [activeStreamIds]);

  const activeStreams = activeStreamIds
    .map(id => streams.find(s => s.id === id))
    .filter(Boolean);

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
                activeStreamIds={activeStreamIds}
                onStreamSelect={setActive}
                onStreamRemove={removeStream}
                onAddStream={() => setShowAddModal(true)}
                onOpenSettings={() => setShowSettings(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <main className="main-content">
          {activeStreams.length > 0 ? (
            <div className="players-container">
              <AnimatePresence initial={false}>
                {activeStreams.map((stream, index) => {
                  const count = activeStreams.length;
                  const isFocused = focusedStreamId === stream.id;
                  const hasFocused = focusedStreamId !== null;
                  const isHidden = hasFocused && !isFocused;

                  let style;
                  if (hasFocused) {
                    style = isFocused
                      ? { left: '0%', top: '0%', width: '100%', height: '100%' }
                      : { left: '50%', top: '50%', width: '0%', height: '0%' };
                  } else if (count === 1) {
                    style = { left: '0%', top: '0%', width: '100%', height: '100%' };
                  } else if (count === 2) {
                    style = {
                      left: index === 0 ? '0%' : '50%',
                      top: '0%',
                      width: '50%',
                      height: '100%',
                    };
                  } else if (count === 3) {
                    if (index === 0) {
                      style = { left: '0%', top: '0%', width: '100%', height: '50%' };
                    } else {
                      style = {
                        left: index === 1 ? '0%' : '50%',
                        top: '50%',
                        width: '50%',
                        height: '50%',
                      };
                    }
                  } else {
                    const row = index < 2 ? 0 : 1;
                    const col = index % 2;
                    style = {
                      left: `${col * 50}%`,
                      top: `${row * 50}%`,
                      width: '50%',
                      height: '50%',
                    };
                  }

                  const centerLeft = parseFloat(style.left) + parseFloat(style.width) / 2;
                  const centerTop = parseFloat(style.top) + parseFloat(style.height) / 2;

                  return (
                    <motion.div
                      key={stream.id}
                      className="player-wrapper"
                      initial={{
                        opacity: 0,
                        left: `${centerLeft}%`,
                        top: `${centerTop}%`,
                        width: '0%',
                        height: '0%',
                      }}
                      animate={{
                        opacity: isHidden ? 0 : 1,
                        left: isHidden ? `${centerLeft}%` : style.left,
                        top: isHidden ? `${centerTop}%` : style.top,
                        width: isHidden ? '0%' : style.width,
                        height: isHidden ? '0%' : style.height,
                      }}
                      exit={{
                        opacity: 0,
                        left: `${centerLeft}%`,
                        top: `${centerTop}%`,
                        width: '0%',
                        height: '0%',
                      }}
                      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                      style={{
                        position: 'absolute',
                        overflow: 'hidden',
                        zIndex: isFocused ? 2 : 1,
                        pointerEvents: isHidden ? 'none' : 'auto',
                      }}
                    >
                      <Player
                        stream={stream}
                        onPlayerClick={count >= 2 ? () => handlePlayerClick(stream.id) : undefined}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
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
        {hasUpdate && updateInfo && !updateDismissed && (
          <motion.div
            className="update-notification"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            <div className="update-content">
              <span className="update-text">
                Доступна новая версия <span className="update-version">v{updateInfo.version}</span>
              </span>
              <div className="update-actions">
                <button
                  className="update-download-btn"
                  onClick={handleInstallUpdate}
                  disabled={isUpdating}
                >
                  {isUpdating ? 'Скачивание...' : 'Установить'}
                </button>
                <button
                  className="update-close-btn"
                  onClick={() => setUpdateDismissed(true)}
                >
                  <HiX />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;