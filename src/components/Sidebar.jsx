import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HiPlus, HiX } from 'react-icons/hi';
import './Sidebar.css';

function Sidebar({ streams, activeStreamId, onStreamSelect, onStreamRemove, onAddStream }) {
  const [onlineStreams, setOnlineStreams] = useState({});

  useEffect(() => {
    const checkStatuses = async () => {
      const statuses = {};
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      await Promise.all(
        streams.map(async (stream) => {
          try {
            const checkUrl = isDev 
              ? `/live-check/${stream.key}.m3u8` 
              : `https://stream.nnfz.ru/live/${stream.key}.m3u8`;

            const response = await fetch(checkUrl, { 
              method: 'GET',
              cache: 'no-cache',
              headers: {
                'Range': 'bytes=0-0'
              }
            });
            
            statuses[stream.id] = response.ok || response.status === 206;
          } catch (e) {
            statuses[stream.id] = false;
          }
        })
      );
      setOnlineStreams(statuses);
    };

    checkStatuses();
    const interval = setInterval(checkStatuses, 10000);
    return () => clearInterval(interval);
  }, [streams]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-text">Stretch</span>
          <span className="logo-subtext">v{import.meta.env.APP_VERSION}</span>
        </div>
      </div>

      <div className="streams-list">
        {streams.map((stream, index) => (
          <motion.div
            key={stream.id}
            className={`stream-item ${activeStreamId === stream.id ? 'active' : ''}`}
            onClick={() => onStreamSelect(stream.id)}
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
