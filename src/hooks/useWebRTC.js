import { useState, useCallback, useRef, useEffect } from 'react';
import { tauriApi } from '../tauriApi';

const getServerUrl = () => {
  return localStorage.getItem('serverUrl') || 'https://stream.nnfz.ru';
};

function enableAudioNack(sdp) {
  const lines = sdp.split('\r\n');
  const result = [];
  const nackPayloadTypes = new Set(
    lines
      .filter(line => line.startsWith('a=rtcp-fb:') && / nack(?: |$)/.test(line))
      .map(line => line.slice('a=rtcp-fb:'.length).split(' ')[0])
  );
  let inAudio = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('m=audio')) {
      inAudio = true;
      result.push(line);
      continue;
    }

    if (line.startsWith('m=video')) {
      inAudio = false;
    }

    result.push(line);

    if (inAudio && line.startsWith('a=rtpmap:')) {
      const pt = line.split(':')[1]?.split(' ')[0];
      if (pt) {
        if (!nackPayloadTypes.has(pt)) {
          result.push(`a=rtcp-fb:${pt} nack`);
          nackPayloadTypes.add(pt);
        }
      }
    }
  }

  return result.join('\r\n');
}

function useWebRTC(videoRef, streamKey) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [isDemuxing, setIsDemuxing] = useState(false);

  const pcRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const checkTimerRef = useRef(null);
  const isConnectingRef = useRef(false);
  const playPromiseRef = useRef(null);
  const generationRef = useRef(0);

  const CHECK_INTERVAL = 5000;

  const cleanup = useCallback(() => {
    generationRef.current++;
    playPromiseRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isConnectingRef.current = false;
  }, [videoRef]);

  const safePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || playPromiseRef.current) return;
    const generation = generationRef.current;
    try {
      playPromiseRef.current = video.play();
      await playPromiseRef.current;
      if (generation !== generationRef.current) return;
      setStatus('playing');
    } catch (err) {
      if (generation !== generationRef.current) return;
      if (err.name === 'NotAllowedError') {
        setStatus('playing');
      } else if (err.name !== 'AbortError') {
        console.error('Play error:', err);
      }
    } finally {
      if (generation === generationRef.current) playPromiseRef.current = null;
    }
  }, [videoRef]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;

    cleanup();
    const generation = generationRef.current;
    const isCurrent = () => generation === generationRef.current;
    isConnectingRef.current = true;
    setStatus('connecting');
    setError(null);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (!isCurrent()) return;
        if (videoRef.current && event.streams[0]) {
          if (videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            safePlay();
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (!isCurrent()) return;
        const state = pc.connectionState;
        if (state === 'connected') {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
          safePlay();
        } else if (state === 'failed' || state === 'disconnected') {
          setStatus('error');
          setError('Соединение потеряно');
          if (reconnectTimerRef.current) return;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (!isCurrent()) return;
            // An unfinished signaling request must not block recovery.
            cleanup();
            connect();
          }, 3000);
        }
      };

      const offer = await pc.createOffer();
      if (!isCurrent()) return;
      const enhancedSDP = enableAudioNack(offer.sdp);

      await pc.setLocalDescription({ type: 'offer', sdp: enhancedSDP });
      if (!isCurrent()) return;

      const serverUrl = getServerUrl();
      const whepUrl = `${serverUrl}/rtc/v1/whep/?app=live&stream=${streamKey}`;
      const answerSDP = await tauriApi.whepRequest(whepUrl, enhancedSDP);
      if (!isCurrent()) return;

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: answerSDP })
      );

      if (!isCurrent()) return;
      isConnectingRef.current = false;
    } catch (err) {
      if (!isCurrent()) return;
      cleanup();
      const retryGeneration = generationRef.current;
      console.error('WebRTC error:', err);
      setStatus('offline');
      setError(err.message || 'Не удалось подключиться');
      isConnectingRef.current = false;
      checkTimerRef.current = setTimeout(() => {
        checkTimerRef.current = null;
        if (generationRef.current === retryGeneration) connect();
      }, CHECK_INTERVAL);
    }
  }, [videoRef, streamKey, cleanup, safePlay]);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('idle');
    setError(null);
    setIsDemuxing(false);
  }, [cleanup]);

  const reconnect = useCallback(() => {
    disconnect();
    const generation = generationRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (generation === generationRef.current) connect();
    }, 100);
  }, [disconnect, connect]);

  const getPC = useCallback(() => pcRef.current, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return { status, error, isDemuxing, connect, disconnect, reconnect, getPC };
}

export default useWebRTC;
