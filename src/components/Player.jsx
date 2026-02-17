import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HiVolumeUp, HiVolumeOff } from 'react-icons/hi';
import { HiArrowsPointingOut, HiArrowsPointingIn } from 'react-icons/hi2';
import useWebRTC from '../hooks/useWebRTC';
import useAdaptiveBuffer from '../hooks/useAdaptiveBuffer';
import './Player.css';

const BOOST_MAX = 300;
const NORMAL_MAX = 100;
const SLIDER_TRANSITION_MS = 350;

function Player({ stream }) {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const prevBytesRef = useRef(0);
  const prevTimestampRef = useRef(0);
  const prevPacketsLostRef = useRef(0);
  const prevPacketsReceivedRef = useRef(0);

  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const audioConnectedRef = useRef(false);

  const [stats, setStats] = useState({
    latency: 0, jitter: 0, packetLoss: 0,
    bitrate: 0, fps: 0, resolution: ''
  });
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimeoutRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef(null);
  const fsSliderRef = useRef(null);
  const previousVolumeRef = useRef(100);

  const [isCtrlHeld, setIsCtrlHeld] = useState(false);
  const [sliderMax, setSliderMax] = useState(() => {
    const saved = localStorage.getItem(`volume_${stream.key}`);
    const v = saved !== null ? parseInt(saved) : 100;
    return v > NORMAL_MAX ? BOOST_MAX : NORMAL_MAX;
  });
  const sliderMaxAnimRef = useRef(sliderMax);
  const animFrameRef = useRef(null);

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
    return saved !== null ? parseInt(saved) : 100;
  });

  const {
    status, error, connect, disconnect, reconnect, getPC
  } = useWebRTC(videoRef, stream.key);

  const {
    bufferInfo, reset: resetBuffer
  } = useAdaptiveBuffer(videoRef, getPC, status === 'playing');

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect, stream.key]);

  const setupAudioBoost = useCallback(() => {
    const video = videoRef.current;
    if (!video || audioConnectedRef.current) return;

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;

      if (ctx.state === 'suspended') ctx.resume();

      sourceNodeRef.current = ctx.createMediaElementSource(video);
      gainNodeRef.current = ctx.createGain();
      sourceNodeRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(ctx.destination);
      audioConnectedRef.current = true;
    } catch (e) {}
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;

    if (volume > NORMAL_MAX && !isMuted) {
      setupAudioBoost();
      video.volume = 1;
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = volume / 100;
      }
    } else {
      video.volume = Math.min(Math.max(volume / 100, 0), 1);
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 1;
      }
    }

    localStorage.setItem(`muted_${stream.key}`, isMuted.toString());
    localStorage.setItem(`volume_${stream.key}`, volume.toString());
  }, [isMuted, volume, stream.key, setupAudioBoost]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
        audioConnectedRef.current = false;
      }
    };
  }, []);

  const animateSliderMax = useCallback((targetMax) => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const startMax = sliderMaxAnimRef.current;
    const startTime = performance.now();

    const tick = (now) => {
      const t = Math.min((now - startTime) / SLIDER_TRANSITION_MS, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const current = Math.round(startMax + (targetMax - startMax) * eased);
      sliderMaxAnimRef.current = current;
      setSliderMax(current);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        sliderMaxAnimRef.current = targetMax;
        setSliderMax(targetMax);
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.key === 'Control' || e.key === 'Meta') && !isCtrlHeld) {
        setIsCtrlHeld(true);
        animateSliderMax(BOOST_MAX);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setIsCtrlHeld(false);
        setVolume(prev => {
          if (prev <= NORMAL_MAX) {
            animateSliderMax(NORMAL_MAX);
          }
          return prev;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isCtrlHeld, animateSliderMax]);

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

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (document.fullscreenElement) setShowControls(false);
    }, 2500);
  }, []);

  useEffect(() => {
    const handler = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (!active) {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    if (status !== 'playing') return;
    const interval = setInterval(async () => {
      const pc = getPC();
      if (!pc) return;
      try {
        const rtcStats = await pc.getStats();
        let latency = 0, jitter = 0, packetsLost = 0, packetsReceived = 0;
        let bytesReceived = 0, timestamp = 0, fps = 0;
        let frameWidth = 0, frameHeight = 0;

        rtcStats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined)
              latency = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.jitter !== undefined) jitter = Math.round(report.jitter * 1000);
            if (report.packetsLost !== undefined) packetsLost = report.packetsLost;
            if (report.packetsReceived !== undefined) packetsReceived = report.packetsReceived;
            if (report.bytesReceived !== undefined) {
              bytesReceived = report.bytesReceived;
              timestamp = report.timestamp;
            }
            if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
            if (report.frameWidth) frameWidth = report.frameWidth;
            if (report.frameHeight) frameHeight = report.frameHeight;
          }
        });

        let bitrate = 0;
        if (prevBytesRef.current > 0 && prevTimestampRef.current > 0) {
          const db = bytesReceived - prevBytesRef.current;
          const dt = (timestamp - prevTimestampRef.current) / 1000;
          if (dt > 0) bitrate = Math.round((db * 8) / dt / 1000);
        }
        prevBytesRef.current = bytesReceived;
        prevTimestampRef.current = timestamp;

        let packetLoss = 0;
        const dL = packetsLost - prevPacketsLostRef.current;
        const dR = packetsReceived - prevPacketsReceivedRef.current;
        if (dR + dL > 0) packetLoss = Math.round((dL / (dR + dL)) * 1000) / 10;
        prevPacketsLostRef.current = packetsLost;
        prevPacketsReceivedRef.current = packetsReceived;

        let resolution = '';
        if (frameWidth && frameHeight) resolution = `${frameWidth}×${frameHeight}`;

        setStats({
          latency, jitter,
          packetLoss: Math.max(0, packetLoss),
          bitrate, fps, resolution
        });
      } catch (err) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [status, getPC]);

  const toggleMute = useCallback((e) => {
    e?.stopPropagation();
    if (!isMuted) {
      previousVolumeRef.current = volume;
      setIsMuted(true);
    } else {
      setIsMuted(false);
      if (volume === 0) setVolume(previousVolumeRef.current > 0 ? previousVolumeRef.current : 100);
    }
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback((e) => {
    e?.stopPropagation();
    const v = parseInt(e.target.value);
    setVolume(v);
    if (v === 0) { if (!isMuted) setIsMuted(true); }
    else { if (isMuted) setIsMuted(false); previousVolumeRef.current = v; }
  }, [isMuted]);

  const handleSliderMouseDown = useCallback((e) => {
    e?.stopPropagation();
    setIsDragging(true);
  }, []);

  const toggleFullscreen = useCallback((e) => {
    e?.stopPropagation();
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleReconnect = useCallback((e) => {
    e?.stopPropagation();
    resetBuffer();
    reconnect();
  }, [resetBuffer, reconnect]);

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
    const min = parseInt(slider.min) || 0;
    const max = sliderMax;
    const val = Math.min(volume, max);
    const percent = (val - min) / (max - min);
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

  const statusInfo = getStatusInfo();
  const connectionQuality = getConnectionQuality();
  const isBoosted = volume > NORMAL_MAX;

  const bufferRefMax = Math.max(
    bufferInfo.target > 0 ? bufferInfo.target * 3 : bufferInfo.delayHint * 3,
    300
  );
  const bufferBarPercent = bufferInfo.hasData
    ? Math.min((bufferInfo.level / bufferRefMax) * 100, 100)
    : 0;
  const targetLinePercent = bufferInfo.target > 0
    ? Math.min((bufferInfo.target / bufferRefMax) * 100, 100)
    : bufferInfo.delayHint > 0
      ? Math.min((bufferInfo.delayHint / bufferRefMax) * 100, 100)
      : 33;

  const renderVolumeSlider = (ref, className) => (
    <div className="volume-wrapper">
      <AnimatePresence>
        {isDragging && (
          <motion.div
            className="volume-tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
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
        max={sliderMax}
        value={Math.min(volume, sliderMax)}
        onChange={handleVolumeChange}
        onMouseDown={handleSliderMouseDown}
        onTouchStart={handleSliderMouseDown}
        className={`${className} ${isDragging ? 'slider-active' : ''} ${isBoosted || isCtrlHeld ? 'boosted' : ''}`}
        style={{
          '--slider-fill': `${(Math.min(volume, sliderMax) / sliderMax) * 100}%`,
        }}
      />
    </div>
  );

  const renderStats = (isFS) => {
    if (status !== 'playing') return null;
    const sep = <span className={isFS ? 'fs-stats-separator' : 'stat-separator'}>•</span>;

    if (!showFullStats) {
      return (
        <div className={isFS ? 'fs-stats mono' : 'stream-stats'}>
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
      <div className={isFS ? 'fs-stats mono' : 'stream-stats'}>
        <span className="stat-item mono">
          <span className="stat-label">Пинг</span>
          <span className="stat-value">{stats.latency}ms</span>
        </span>
        {sep}
        <span className="stat-item mono">
          <span className="stat-label">Джиттер</span>
          <span className="stat-value">{stats.jitter}ms</span>
        </span>
        {sep}
        <span className="stat-item mono">
          <span className="stat-label">Потери</span>
          <span className={`stat-value ${stats.packetLoss > 2 ? 'stat-bad' : stats.packetLoss > 0 ? 'stat-warn' : ''}`}>
            {stats.packetLoss}%
          </span>
        </span>
        {sep}
        <span className="stat-item mono">
          <span className="stat-label">Битрейт</span>
          <span className="stat-value">
            {stats.bitrate > 1000
              ? `${(stats.bitrate / 1000).toFixed(1)} Mbps`
              : `${stats.bitrate} Kbps`}
          </span>
        </span>
        {sep}
        <span className="stat-item mono">
          <span className="stat-label">FPS</span>
          <span className="stat-value">{stats.fps}</span>
        </span>
        {stats.resolution && (
          <>{sep}
            <span className="stat-item mono">
              <span className="stat-value">{stats.resolution}</span>
            </span>
          </>
        )}
        {sep}
        <span className="stat-item mono buffer-stat">
          <span className={`buffer-health-dot ${bufferInfo.health}`} />
          <span className="stat-label">Буфер</span>
          <span className="stat-value">
            {bufferInfo.hasData ? (
              <>
                {bufferInfo.level}
                <span className="stat-unit">ms</span>
                {bufferInfo.target > 0 && (
                  <span className="stat-target">
                    {' '}/ {bufferInfo.target}<span className="stat-unit">ms</span>
                  </span>
                )}
              </>
            ) : '—'}
          </span>
        </span>
        {bufferInfo.delayHint > 60 && (
          <>{sep}
            <span className={`stat-item mono hint-badge ${bufferInfo.delayHint > 200 ? 'hint-high' : 'hint-mid'}`}>
              🛡 {bufferInfo.delayHint}<span className="stat-unit">ms</span>
            </span>
          </>
        )}
        {bufferInfo.droppedRate > 0 && (
          <>{sep}
            <span className="stat-item mono">
              <span className="stat-label">Дропы</span>
              <span className={`stat-value ${
                bufferInfo.droppedRate > 5 ? 'stat-bad' :
                bufferInfo.droppedRate > 1 ? 'stat-warn' : ''
              }`}>
                {bufferInfo.droppedRate}<span className="stat-unit">/с</span>
              </span>
            </span>
          </>
        )}
        {bufferInfo.stalls > 0 && (
          <>{sep}
            <span className="stat-item mono">
              <span className="stat-label">Фризы</span>
              <span className="stat-value stat-warn">{bufferInfo.stalls}</span>
            </span>
          </>
        )}
        {sep}
        <span className={`stat-item connection-quality ${connectionQuality.color}`}>
          {connectionQuality.text}
        </span>
      </div>
    );
  };

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
        <video ref={videoRef} autoPlay playsInline className="video-element" />

        {showFullStats && status === 'playing' && bufferInfo.hasData && (
          <div className="buffer-health-bar">
            <div
              className={`buffer-health-fill ${bufferInfo.health}`}
              style={{ width: `${bufferBarPercent}%` }}
            />
            <div
              className="buffer-target-line"
              style={{ left: `${targetLinePercent}%` }}
            />
          </div>
        )}

        <AnimatePresence>
          {bufferInfo.health === 'critical' && status === 'playing' && (
            <motion.div
              className="buffering-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="buffering-content">
                <div className="mini-spinner" />
                <span>Буферизация...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {status !== 'playing' && (
          <div className="video-overlay">
            <motion.div className="status-indicator"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {status === 'connecting' && <div className="spinner" />}
              <div className={`status-text ${statusInfo.color}`}>{statusInfo.text}</div>
              {error && <div className="error-text">{error}</div>}
              {status === 'error' && (
                <button className="retry-btn" onClick={handleReconnect}>
                  Переподключиться
                </button>
              )}
            </motion.div>
          </div>
        )}

        <AnimatePresence>
          {isFullscreen && showControls && (
            <motion.div
              className="fullscreen-ui"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="fs-top-bar">
                <div className="fs-stream-info">
                  <span className="fs-name">{stream.name}</span>
                  {renderStats(true)}
                </div>
              </div>
              <div className="fs-bottom-bar">
                <div className="fs-controls-right">
                  <div className="fs-controls-group">
                    <button className="fs-btn" onClick={toggleMute}>
                      {isMuted ? <HiVolumeOff /> : <HiVolumeUp />}
                    </button>
                    {renderVolumeSlider(fsSliderRef, 'fs-slider')}
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

      {!isFullscreen && (
        <div className="controls">
          <div className="controls-left">
            <div className={`status-badge ${statusInfo.color}`}>
              <div className="status-dot" />
              {statusInfo.text}
            </div>
            {renderStats(false)}
          </div>
          <div className="controls-right">
            <button className={`control-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
              {isMuted ? <HiVolumeOff /> : <HiVolumeUp />}
            </button>
            {renderVolumeSlider(sliderRef, 'slider')}
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
