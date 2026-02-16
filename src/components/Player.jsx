import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HiVolumeUp, HiVolumeOff } from 'react-icons/hi';
import { HiArrowsPointingOut, HiArrowsPointingIn } from 'react-icons/hi2';
import useWebRTC from '../hooks/useWebRTC';
import './Player.css';

function Player({ stream }) {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const [stats, setStats] = useState({ latency: 0 });
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimeoutRef = useRef(null);
  
  const [isMuted, setIsMuted] = useState(() => {
    const saved = localStorage.getItem(`muted_${stream.key}`);
    return saved !== null ? saved === 'true' : true;
  });

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem(`volume_${stream.key}`);
    return saved !== null ? parseInt(saved) : 100;
  });
  
  const { 
    status, 
    error, 
    connect, 
    disconnect,
    reconnect
  } = useWebRTC(videoRef, stream.key);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect, stream.key]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume / 100;
      localStorage.setItem(`muted_${stream.key}`, isMuted.toString());
      localStorage.setItem(`volume_${stream.key}`, volume.toString());
    }
  }, [isMuted, volume, stream.key]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (document.fullscreenElement) {
        setShowControls(false);
      }
    }, 2500);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (!active) {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const interval = setInterval(() => {
      if (videoRef.current) {
        const video = videoRef.current;
        const buffered = video.buffered;
        if (buffered.length > 0) {
          const latency = (buffered.end(buffered.length - 1) - video.currentTime) * 1000;
          setStats(prev => ({ ...prev, latency: Math.round(latency) }));
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const toggleMute = useCallback((e) => {
    e?.stopPropagation();
    setIsMuted(prev => !prev);
  }, []);

  const handleVolumeChange = useCallback((e) => {
    e?.stopPropagation();
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleFullscreen = useCallback((e) => {
    e?.stopPropagation();
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(err => {
        console.error(`Fullscreen error: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  const getStatusInfo = () => {
    switch (status) {
      case 'connecting': return { text: 'Подключение...', color: 'warning' };
      case 'connected': return { text: 'Подключено', color: 'success' };
      case 'playing': return { text: 'В эфире', color: 'live' };
      case 'error': return { text: 'Ошибка', color: 'error' };
      case 'offline': return { text: 'Оффлайн', color: 'offline' };
      default: return { text: 'Готов', color: 'idle' };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <motion.div 
      ref={playerContainerRef}
      className={`player ${isFullscreen ? 'is-fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="video-container" onClick={toggleFullscreen}>
        <video 
          ref={videoRef}
          autoPlay
          playsInline
          className="video-element"
        />
        
        {status !== 'playing' && (
          <div className="video-overlay">
            <motion.div
              className="status-indicator"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {status === 'connecting' && <div className="spinner" />}
              <div className={`status-text ${statusInfo.color}`}>{statusInfo.text}</div>
              {error && <div className="error-text">{error}</div>}
              {status === 'error' && <button className="retry-btn" onClick={(e) => { e.stopPropagation(); reconnect(); }}>Переподключиться</button>}
            </motion.div>
          </div>
        )}

        {/* Фуллскрин оверлей */}
        <AnimatePresence>
          {isFullscreen && showControls && (
            <motion.div 
              className="fullscreen-ui"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="fs-top-bar">
                <div className="fs-stream-info">
                  <span className="fs-name">{stream.name}</span>
                  <span className="fs-stats mono">Задержка: {stats.latency}ms</span>
                </div>
              </div>

              <div className="fs-bottom-bar">
                <div className="fs-controls-right">
                  <div className="fs-controls-group">
                    <button className="fs-btn" onClick={toggleMute}>
                      {isMuted ? <HiVolumeOff /> : <HiVolumeUp />}
                    </button>
                    <div className="fs-volume-wrapper">
                      <input 
                        type="range" min="0" max="100" value={volume}
                        onChange={handleVolumeChange} className="fs-slider"
                      />
                    </div>
                  </div>
                  <button className="fs-btn fs-exit-btn" onClick={toggleFullscreen}>
                    <HiArrowsPointingIn />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Обычный режим (не фуллскрин) */}
      {!isFullscreen && (
        <div className="controls">
          <div className="controls-left">
            <div className={`status-badge ${statusInfo.color}`}>
              <div className="status-dot" />
              {statusInfo.text}
            </div>
            {status === 'playing' && (
              <div className="stream-stats">
                <span className="stat-item mono">
                  <span className="stat-label">Задержка:</span>
                  <span className="stat-value">{Math.round(stats.latency / 1000 * 100) / 100}s</span>
                </span>
              </div>
            )}
          </div>

          <div className="controls-right">
            <button className={`control-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
              {isMuted ? <HiVolumeOff /> : <HiVolumeUp />}
            </button>
            <input 
              type="range" min="0" max="100" value={volume}
              onChange={handleVolumeChange} className="slider"
            />
            <button className="control-btn" onClick={toggleFullscreen}>
              <HiArrowsPointingOut />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default Player;
