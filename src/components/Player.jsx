import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HiVolumeUp, HiVolumeOff } from 'react-icons/hi';
import { HiArrowsPointingOut, HiArrowsPointingIn } from 'react-icons/hi2';
import useWebRTC from '../hooks/useWebRTC';
import useAdaptiveBuffer from '../hooks/useAdaptiveBuffer';
import './Player.css';

// === WEB AUDIO API — MediaStream подход ===
let globalAudioCtx = null;

function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    const AC = window.AudioContext || window.webkitAudioContext;
    globalAudioCtx = new AC();
    console.log('[Audio] AudioContext created, state:', globalAudioCtx.state);
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
      console.log('[Audio] Pipeline exists and valid for', id);
      return existing;
    }
    console.log('[Audio] Stream changed, rebuilding pipeline');
    destroyAudioPipeline(id);
  }

  const mediaStream = videoEl.srcObject;
  if (!mediaStream) {
    console.warn('[Audio] No srcObject on video');
    return null;
  }

  const audioTracks = mediaStream.getAudioTracks();
  console.log('[Audio] Audio tracks:', audioTracks.length, audioTracks.map(t => ({
    id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState
  })));

  if (audioTracks.length === 0) {
    console.warn('[Audio] No audio tracks in stream!');
    return null;
  }

  try {
    const ctx = getAudioContext();

    // Создаём отдельный MediaStream только с аудио
    const audioOnlyStream = new MediaStream(audioTracks);
    const source = ctx.createMediaStreamSource(audioOnlyStream);

    console.log('[Audio] MediaStreamSource created:', {
      numberOfOutputs: source.numberOfOutputs,
      channelCount: source.channelCount
    });

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;

    // Анализатор для мониторинга
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    // source -> gain -> analyser -> destination
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);

    // ВАЖНО: глушим нативный звук видео, чтобы не было двойного звука
    videoEl.muted = true;

    const nodes = { ctx, source, gainNode, analyser, videoEl, mediaStream, audioOnlyStream };
    audioNodes.set(id, nodes);

    startSignalMonitor(id);

    console.log('[Audio] ✅ Pipeline created for', id, '(MediaStream approach)');
    return nodes;
  } catch (e) {
    console.error('[Audio] ❌ Pipeline failed:', e);
    return null;
  }
}

function startSignalMonitor(streamKey) {
  let checkCount = 0;
  const maxChecks = 10;

  const check = () => {
    const n = audioNodes.get(streamKey);
    if (!n || !n.analyser) return;

    const data = new Uint8Array(n.analyser.frequencyBinCount);
    n.analyser.getByteFrequencyData(data);
    const sum = data.reduce((a, b) => a + b, 0);
    const peak = Math.max(...data);
    checkCount++;

    if (checkCount <= 3 || sum === 0) {
      console.log(`[Audio] Signal #${checkCount}: avg=${(sum/data.length).toFixed(1)} peak=${peak} gain=${n.gainNode.gain.value.toFixed(3)} ctx=${n.ctx.state} videoMuted=${n.videoEl.muted}`);
    }

    if (sum === 0 && checkCount <= 3) {
      console.warn('[Audio] ⚠️ No signal!');
    } else if (sum > 0 && checkCount <= 3) {
      console.log('[Audio] ✅ Signal detected!');
    }

    if (checkCount < maxChecks) setTimeout(check, 500);
  };

  setTimeout(check, 200);
}

function applyVolume(videoEl, streamKey, volumePercent, isMuted) {
  if (!videoEl) return;
  const id = streamKey || 'default';
  const nodes = audioNodes.get(id);

  if (!nodes) {
    // Фолбэк: нативная громкость (без усиления >100%)
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : Math.min(volumePercent / 100, 1.0);
    return;
  }

  if (nodes.ctx.state === 'suspended') {
    nodes.ctx.resume().catch(console.error);
  }

  // При Web Audio подходе: video MUTED (звук идёт через AudioContext)
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
    if (nodes.analyser) nodes.analyser.disconnect();
  } catch (e) {}

  audioNodes.delete(id);
  console.log('[Audio] Pipeline destroyed for', id);
}

// ==========================================

function Player({ stream }) {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const prevBytesRef = useRef(0);
  const prevTimestampRef = useRef(0);
  const prevPacketsLostRef = useRef(0);
  const prevPacketsReceivedRef = useRef(0);
  const audioInitializedRef = useRef(false);

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

  const {
    status, error, connect, disconnect, reconnect, getPC
  } = useWebRTC(videoRef, stream.key);

  const {
    bufferInfo, reset: resetBuffer
  } = useAdaptiveBuffer(videoRef, getPC, status === 'playing');

  const initAudio = useCallback(() => {
    if (!videoRef.current) return;
    if (!videoRef.current.srcObject) {
      console.log('[Audio] No srcObject yet, skipping init');
      return;
    }

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

  // Когда видео начинает играть
  useEffect(() => {
    if (status !== 'playing') return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const onPlaying = () => {
      console.log('[Audio] Video playing, audioInit:', audioInitializedRef.current);

      if (audioInitializedRef.current) {
        applyVolume(videoEl, stream.key, volumeRef.current, mutedRef.current);
      } else {
        // Фолбэк без Web Audio
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
    destroyAudioPipeline(stream.key);
    audioInitializedRef.current = false;
    reconnect();
  }, [resetBuffer, reconnect, stream.key]);

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
      className={`player ${isFullscreen ? 'is-fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="video-container" onClick={toggleFullscreen}>
        <video ref={videoRef} autoPlay playsInline muted className="video-element" />

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
          {isFullscreen && showControls && (
            <motion.div className="fullscreen-ui" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => e.stopPropagation()}>
              <div className="fs-top-bar">
                <div className="fs-stream-info">
                  <span className="fs-name">{stream.name}</span>
                  {renderStats(true)}
                </div>
              </div>
              <div className="fs-bottom-bar">
                <div className="fs-controls-right">
                  <div className="fs-controls-group">
                    <button className="fs-btn" onClick={toggleMute}>{getVolumeIcon()}</button>
                    {renderVolumeSlider(fsSliderRef, 'fs-slider')}
                  </div>
                  <button className="fs-btn fs-exit-btn" onClick={toggleFullscreen}><HiArrowsPointingIn /></button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isFullscreen && (
        <div className="controls">
          <div className="controls-left">
            <div className={`status-badge ${statusInfo.color}`}><div className="status-dot" />{statusInfo.text}</div>
            {renderStats(false)}
          </div>
          <div className="controls-right">
            <button className={`control-btn ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>{getVolumeIcon()}</button>
            {renderVolumeSlider(sliderRef, 'slider')}
            <button className="control-btn" onClick={toggleFullscreen}><HiArrowsPointingOut /></button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default Player;