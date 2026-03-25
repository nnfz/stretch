import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HiPlus, HiMinus, HiX, HiCog } from 'react-icons/hi';
import { useAppFocus } from '../hooks/AppFocusContext';
import { tauriApi } from '../tauriApi';
import './Sidebar.css';

function Sidebar({ streams, activeStreamIds = [], onStreamSelect, onStreamRemove, onAddStream, onOpenSettings }) {
  const [onlineStreams, setOnlineStreams] = useState({});
  const appFocused = useAppFocus();

  useEffect(() => {
    if (!appFocused) return;

    const checkStatuses = async () => {
      const statuses = {};

      await Promise.all(
        streams.map(async (stream) => {
          try {
            const serverUrl = localStorage.getItem('serverUrl') || 'https://stream.nnfz.ru';
            const url = `${serverUrl}/live/${stream.key}.m3u8`;
            statuses[stream.id] = await tauriApi.checkStreamLive(url);
          } catch {
            statuses[stream.id] = false;
          }
        })
      );
      setOnlineStreams(statuses);
    };

    checkStatuses();
    const interval = setInterval(checkStatuses, 30000);
    return () => clearInterval(interval);
  }, [streams, appFocused]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-text">Stretch</span>
          <span className="logo-subtext">v{import.meta.env.APP_VERSION}</span>
        </div>
        <button className="settings-btn" onClick={onOpenSettings}>
          <HiCog className="settings-icon" />
        </button>
      </div>

      <div className="streams-list">
        {streams.map((stream, index) => (
          <motion.div
            key={stream.id}
            className={`stream-item ${activeStreamIds.includes(stream.id) ? 'active' : ''}`}
            onClick={(e) => onStreamSelect(stream.id, e.ctrlKey || e.metaKey)}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <div className="stream-status">
              {onlineStreams[stream.id] && <div className="live-dot" title="В эфире" />}
            </div>
            <div className="stream-info">
              <div className="stream-name">{stream.name}</div>
              <div className="stream-key mono">{stream.key}</div>
            </div>
            <button
              className={`add-btn ${activeStreamIds.includes(stream.id) ? 'added' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onStreamSelect(stream.id, true);
              }}
              title={activeStreamIds.includes(stream.id) ? 'Убрать' : 'Добавить'}
            >
              {activeStreamIds.includes(stream.id) ? <HiMinus /> : <HiPlus />}
            </button>
            <button
              className="remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                onStreamRemove(stream.id);
              }}
              title="Удалить"
            >
              <HiX />
            </button>
          </motion.div>
        ))}
      </div>

      <button className="add-stream-btn" onClick={onAddStream}>
        <HiPlus className="add-icon" />
        <span>Добавить стрим</span>
      </button>
    </aside>
  );
}

export default Sidebar;