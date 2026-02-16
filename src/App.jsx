import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Player from './components/Player';
import AddStreamModal from './components/AddStreamModal';
import './App.css';

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
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

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
    setIsSidebarVisible(prev => !prev);
  }, []);

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
    </div>
  );
}

export default App;
