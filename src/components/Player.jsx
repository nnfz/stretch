import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HiVolumeUp, HiVolumeOff } from 'react-icons/hi';
import { HiArrowsPointingOut, HiArrowsPointingIn } from 'react-icons/hi2';
import { getCurrentWindow } from '@tauri-apps/api/window';
import useWebRTC from '../hooks/useWebRTC';
import useStreamStats from '../hooks/useStreamStats';
import { useAppFocus } from '../hooks/AppFocusContext';
import './Player.css';

// === WEB AUDIO API ===
let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    const AC = window.AudioContext || window.webkitAudioContext;
    globalAudioCtx = new AC();
  }
  return globalAudioCtx;
}

const audioNodes = new Map();

function ensureAudioPipeline(videoEl, streamKey) {
  if (!videoEl) return null;
  const id = streamKey || 'default';

  if (audioNodes.has(id)) {
    const existing = audioNodes.get(id);
    if (existing.videoEl === videoEl && existing.mediaStream === videoEl.srcObject) {
      return existing;
    }
    destroyAudioPipeline(id);
  }

  const mediaStream = videoEl.srcObject;
  if (!mediaStream) return null;

  const audioTracks = mediaStream.getAudioTracks();
  if (audioTracks.length === 0) return null;

  try {
    const ctx = getAudioContext();
    const audioOnlyStream = new MediaStream(audioTracks);
    const source = ctx.createMediaStreamSource(audioOnlyStream);
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    videoEl.muted = true;

    const nodes = { ctx, source, gainNode, videoEl, mediaStream, audioOnlyStream };
    audioNodes.set(id, nodes);
    return nodes;
  } catch {
    return null;
  }
}

function applyVolume(videoEl, streamKey, volumePercent, isMuted) {
  if (!videoEl) return;
  const id = streamKey || 'default';
  const nodes = audioNodes.get(id);

  if (!nodes) {
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : Math.min(volumePercent / 100, 1.0);
    return;
  }

  if (nodes.ctx.state === 'suspended') {
    nodes.ctx.resume().catch(() => {});
  }

  videoEl.muted = true;

  const targetGain = isMuted ? 0 : volumePercent / 100;
  const now = nodes.ctx.currentTime;
  nodes.gainNode.gain.cancelScheduledValues(now);
  nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
  nodes.gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.03);
}

function destroyAudioPipeline(streamKey) {
  const id = streamKey || 'default';
  const nodes = audioNodes.get(id);
  if (!nodes) return;

  try {
    nodes.source.disconnect();
    nodes.gainNode.disconnect();
  } catch {}

  audioNodes.delete(id);
}

// ==========================================

function Player({ stream, isPinned, onPlayerClick }) {               // ← isPinned проп
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const audioInitializedRef = useRef(false);
  const wasMaximizedRef = useRef(false);
  const wasPinnedRef = useRef(false);
  const appFocused = useAppFocus();

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimeoutRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef(null);
  const previousVolumeRef = useRef(100);

  const [showFullStats, setShowFullStats] = useState(() => {
    const saved = localStorage.getItem('showFullStats');
    return saved === 'true';
  });

  useEffect(() => {
    const onSettingsChanged = (e) => {
      if (e.detail && typeof e.detail.showFullStats === 'boolean') {
        setShowFullStats(e.detail.showFullStats);
      }
    };
    window.addEventListener('settingsChanged', onSettingsChanged);
    return () => window.removeEventListener('settingsChanged', onSettingsChanged);
  }, []);

  const [isMuted, setIsMuted] = useState(() => {
    const saved = localStorage.getItem(`muted_${stream.key}`);
    return saved !== null ? saved === 'true' : true;
  });

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem(`volume_${stream.key}`);
    return saved !== null ? Math.min(parseInt(saved), 300) : 100;
  });

  const volumeRef = useRef(volume);
  const mutedRef = useRef(isMuted);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  // Храним актуальное значение isPinned в ref для использования в toggleFullscreen
  const isPinnedRef = useRef(isPinned);
  useEffect(() => { isPinnedRef.current = isPinned; }, [isPinned]);

  const {
    status, error, connect, disconnect, reconnect, getPC
  } = useWebRTC(videoRef, stream.key);

  const {
    stats, bufferInfo, reset: resetStats
  } = useStreamStats(videoRef, getPC, status === 'playing', appFocused);

  const initAudio = useCallback(() => {
    if (!videoRef.current || !videoRef.current.srcObject) return;

    const nodes = ensureAudioPipeline(videoRef.current, stream.key);
    if (nodes) {
      audioInitializedRef.current = true;
      applyVolume(videoRef.current, stream.key, volumeRef.current, mutedRef.current);
    }
  }, [stream.key]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
      destroyAudioPipeline(stream.key);
      audioInitializedRef.current = false;
    };
  }, [connect, disconnect, stream.key]);

  useEffect(() => {
    if (status !== 'playing') return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const onPlaying = () => {
      if (audioInitializedRef.current) {
        applyVolume(videoEl, stream.key, volumeRef.current, mutedRef.current);
      } else {
        if (!mutedRef.current) {
          videoEl.muted = false;
          videoEl.volume = Math.min(volumeRef.current / 100, 1.0);
        }
      }
    };

    videoEl.addEventListener('playing', onPlaying);
    if (!videoEl.paused && videoEl.readyState >= 2) onPlaying();

    return () => videoEl.removeEventListener('playing', onPlaying);
  }, [status, stream.key]);

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    initAudio();

    const val = parseInt(e.target.value);
    setVolume(val);

    const shouldMute = val === 0;
    if (shouldMute !== isMuted) setIsMuted(shouldMute);
    if (!shouldMute) previousVolumeRef.current = val;

    applyVolume(videoRef.current, stream.key, val, shouldMute);

    localStorage.setItem(`volume_${stream.key}`, val.toString());
    localStorage.setItem(`muted_${stream.key}`, shouldMute.toString());
  };

  const toggleMute = (e) => {
    e?.stopPropagation();
    initAudio();

    let nextMuted, nextVol;
    if (isMuted) {
      nextMuted = false;
      nextVol = volume === 0 ? (previousVolumeRef.current || 100) : volume;
      setVolume(nextVol);
    } else {
      nextMuted = true;
      nextVol = volume;
      previousVolumeRef.current = volume;
    }

    setIsMuted(nextMuted);
    applyVolume(videoRef.current, stream.key, nextVol, nextMuted);

    localStorage.setItem(`volume_${stream.key}`, nextVol.toString());
    localStorage.setItem(`muted_${stream.key}`, nextMuted.toString());
  };

  const handleSliderMouseDown = (e) => {
    e?.stopPropagation();
    setIsDragging(true);
    initAudio();
  };

  useEffect(() => {
    if (!isDragging) return;
    const up = () => setIsDragging(false);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }, [isDragging]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    initAudio();

    const step = 5;
    const delta = e.deltaY < 0 ? step : -step;
    const newVol = Math.max(0, Math.min(300, volumeRef.current + delta));

    setVolume(newVol);
    const shouldMute = newVol === 0;
    if (shouldMute !== mutedRef.current) setIsMuted(shouldMute);
    if (!shouldMute) previousVolumeRef.current = newVol;

    applyVolume(videoRef.current, stream.key, newVol, shouldMute);
    localStorage.setItem(`volume_${stream.key}`, newVol.toString());
    localStorage.setItem(`muted_${stream.key}`, shouldMute.toString());
  }, [initAudio, stream.key]);

  useEffect(() => {
    const el = playerContainerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 2500);
  }, []);

  useEffect(() => {
    const handler = async () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);

      if (!active) {
        try {
          const appWindow = getCurrentWindow();
          await new Promise(r => setTimeout(r, 50));

          if (wasPinnedRef.current) {
            wasPinnedRef.current = false;
            await appWindow.setAlwaysOnTop(true);
          }

          if (wasMaximizedRef.current) {
            wasMaximizedRef.current = false;
            await appWindow.maximize();
          }
        } catch {}
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (status === 'playing') {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [status]);

  const toggleFullscreen = useCallback(async (e) => {
    e?.stopPropagation();
    if (!playerContainerRef.current) return;

    if (!document.fullscreenElement) {
      try {
        const appWindow = getCurrentWindow();
        let needWait = false;

        // Используем проп через ref — никаких запросов к API
        if (isPinnedRef.current) {
          wasPinnedRef.current = true;
          await appWindow.setAlwaysOnTop(false);
          needWait = true;
        }

        const maximized = await appWindow.isMaximized();
        if (maximized) {
          wasMaximizedRef.current = true;
          await appWindow.unmaximize();
          needWait = true;
        }

        if (needWait) {
          await new Promise(r => setTimeout(r, 150));
        }
      } catch (err) {
        console.error('Pre-fullscreen error:', err);
      }

      playerContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleReconnect = useCallback((e) => {
    e?.stopPropagation();
    resetStats();
    destroyAudioPipeline(stream.key);
    audioInitializedRef.current = false;
    reconnect();
  }, [resetStats, reconnect, stream.key]);

  const getStatusInfo = () => {
    switch (status) {
      case 'connecting': return { text: 'Подключение...', color: 'warning' };
      case 'connected': return { text: 'Подключено', color: 'success' };
      case 'playing': return { text: 'В эфире', color: 'live' };
      case 'error': return { text: 'Ошибка', color: 'error' };
      default: return { text: 'Не в сети', color: 'offline' };
    }
  };

  const getThumbPosition = (slider) => {
    if (!slider) return '50%';
    const percent = volume / 300;
    const thumbWidth = 14;
    const trackWidth = slider.offsetWidth;
    return `${percent * (trackWidth - thumbWidth) + thumbWidth / 2}px`;
  };

  const getConnectionQuality = () => {
    const { latency, jitter, packetLoss, bitrate } = stats;
    if (bitrate === 0 && latency === 0) return { text: '—', color: 'offline' };
    if (packetLoss > 5 || latency > 300 || jitter > 50) return { text: 'Плохое', color: 'poor' };
    if (packetLoss > 2 || latency > 150 || jitter > 30) return { text: 'Среднее', color: 'fair' };
    if (packetLoss > 0.5 || latency > 80 || jitter > 15) return { text: 'Хорошее', color: 'good' };
    return { text: 'Отличное', color: 'excellent' };
  };

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return <HiVolumeOff />;
    return <HiVolumeUp />;
  };

  const statusInfo = getStatusInfo();
  const connectionQuality = getConnectionQuality();

  const bufferRefMax = Math.max(
    bufferInfo.target > 0 ? bufferInfo.target * 3 : bufferInfo.delayHint * 3,
    300
  );
  const bufferBarPercent = bufferInfo.hasData
    ? Math.min((bufferInfo.level / bufferRefMax) * 100, 100) : 0;
  const targetLinePercent = bufferInfo.target > 0
    ? Math.min((bufferInfo.target / bufferRefMax) * 100, 100)
    : bufferInfo.delayHint > 0
      ? Math.min((bufferInfo.delayHint / bufferRefMax) * 100, 100) : 33;

  const renderVolumeSlider = (ref, className) => {
    const isBoosted = volume > 100;

    return (
      <div className="volume-wrapper">
        <AnimatePresence>
          {isDragging && (
            <motion.div
              className="volume-tooltip"
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -15, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              style={{ left: getThumbPosition(ref.current) }}
            >
              {volume}%
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={ref}
          type="range"
          min="0"
          max="300"
          value={volume}
          onChange={handleVolumeChange}
          onMouseDown={handleSliderMouseDown}
          onTouchStart={handleSliderMouseDown}
          className={`${className} ${isDragging ? 'slider-active' : ''} ${isBoosted ? 'boosted' : ''}`}
          style={{
            '--slider-fill': `${(volume / 300) * 100}%`,
            '--normal-zone': `${(100 / 300) * 100}%`
          }}
        />
      </div>
    );
  };

  const renderStats = () => {
    if (status !== 'playing') return null;
    const sep = <span className="fs-stats-separator">•</span>;

    if (!showFullStats) {
      return (
        <div className="fs-stats mono">
          <span className="stat-item mono">
            <span className="stat-label">Пинг</span>
            <span className="stat-value">{stats.latency}ms</span>
          </span>
          {sep}
          <span className="stat-item mono">
            <span className="stat-label">Потери</span>
            <span className={`stat-value ${stats.packetLoss > 2 ? 'stat-bad' : stats.packetLoss > 0 ? 'stat-warn' : ''}`}>
              {stats.packetLoss}%
            </span>
          </span>
          {sep}
          <span className={`stat-item connection-quality ${connectionQuality.color}`}>
            {connectionQuality.text}
          </span>
        </div>
      );
    }

    return (
      <div className="fs-stats mono">
        <span className="stat-item mono"><span className="stat-label">Пинг</span><span className="stat-value">{stats.latency}ms</span></span>
        {sep}
        <span className="stat-item mono"><span className="stat-label">Джиттер</span><span className="stat-value">{stats.jitter}ms</span></span>
        {sep}
        <span className="stat-item mono"><span className="stat-label">Потери</span>
          <span className={`stat-value ${stats.packetLoss > 2 ? 'stat-bad' : stats.packetLoss > 0 ? 'stat-warn' : ''}`}>{stats.packetLoss}%</span>
        </span>
        {sep}
        <span className="stat-item mono"><span className="stat-label">Битрейт</span>
          <span className="stat-value">{stats.bitrate > 1000 ? `${(stats.bitrate/1000).toFixed(1)} Mbps` : `${stats.bitrate} Kbps`}</span>
        </span>
        {sep}
        <span className="stat-item mono"><span className="stat-label">FPS</span><span className="stat-value">{stats.fps}</span></span>
        {stats.resolution && <>{sep}<span className="stat-item mono"><span className="stat-value">{stats.resolution}</span></span></>}
        {sep}
        <span className="stat-item mono buffer-stat">
          <span className={`buffer-health-dot ${bufferInfo.health}`} />
          <span className="stat-label">Буфер</span>
          <span className="stat-value">
            {bufferInfo.hasData ? <>{bufferInfo.level}<span className="stat-unit">ms</span>
              {bufferInfo.target > 0 && <span className="stat-target"> / {bufferInfo.target}<span className="stat-unit">ms</span></span>}
            </> : '—'}
          </span>
        </span>
        {bufferInfo.delayHint > 60 && <>{sep}<span className={`stat-item mono hint-badge ${bufferInfo.delayHint > 200 ? 'hint-high' : 'hint-mid'}`}>🛡 {bufferInfo.delayHint}<span className="stat-unit">ms</span></span></>}
        {bufferInfo.droppedRate > 0 && <>{sep}<span className="stat-item mono"><span className="stat-label">Дропы</span>
          <span className={`stat-value ${bufferInfo.droppedRate > 5 ? 'stat-bad' : bufferInfo.droppedRate > 1 ? 'stat-warn' : ''}`}>{bufferInfo.droppedRate}<span className="stat-unit">/с</span></span></span></>}
        {bufferInfo.stalls > 0 && <>{sep}<span className="stat-item mono"><span className="stat-label">Фризы</span><span className="stat-value stat-warn">{bufferInfo.stalls}</span></span></>}
        {sep}
        <span className={`stat-item connection-quality ${connectionQuality.color}`}>{connectionQuality.text}</span>
      </div>
    );
  };

  return (
    <motion.div
      ref={playerContainerRef}
      className={`player ${isFullscreen ? 'is-fullscreen' : ''} ${!showControls && status === 'playing' ? 'controls-hidden' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 1000);
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="video-container" onClick={!isFullscreen && onPlayerClick ? onPlayerClick : undefined}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`video-element ${onPlayerClick && !isFullscreen ? 'clickable' : ''}`}
        />

        {showFullStats && status === 'playing' && bufferInfo.hasData && (
          <div className="buffer-health-bar">
            <div className={`buffer-health-fill ${bufferInfo.health}`} style={{ width: `${bufferBarPercent}%` }} />
            <div className="buffer-target-line" style={{ left: `${targetLinePercent}%` }} />
          </div>
        )}

        <AnimatePresence>
          {bufferInfo.health === 'critical' && status === 'playing' && (
            <motion.div className="buffering-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <div className="buffering-content"><div className="mini-spinner" /><span>Буферизация...</span></div>
            </motion.div>
          )}
        </AnimatePresence>

        {status !== 'playing' && (
          <div className="video-overlay">
            <motion.div className="status-indicator" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              {status === 'connecting' && <div className="spinner" />}
              <div className={`status-text ${statusInfo.color}`}>{statusInfo.text}</div>
              {error && <div className="error-text">{error}</div>}
              {status === 'error' && <button className="retry-btn" onClick={handleReconnect}>Переподключиться</button>}
            </motion.div>
          </div>
        )}

        <AnimatePresence>
          {showControls && status === 'playing' && (
            <motion.div
              className="fullscreen-ui"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="fs-top-bar">
                <div className="fs-stream-info">
                  <span className="fs-name">{stream.name}</span>
                  {renderStats()}
                </div>
              </div>
              <div className="fs-bottom-bar">
                <div className="fs-controls-right">
                  <div className="fs-controls-group">
                    <button className="fs-btn" onClick={toggleMute}>{getVolumeIcon()}</button>
                    {renderVolumeSlider(sliderRef, 'fs-slider')}
                  </div>
                  <button className="fs-btn fs-exit-btn" onClick={toggleFullscreen}>
                    {isFullscreen ? <HiArrowsPointingIn /> : <HiArrowsPointingOut />}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default Player;