import { useState, useCallback, useRef, useEffect } from 'react';
import { tauriApi } from '../tauriApi';

const getServerUrl = () => {
  return localStorage.getItem('serverUrl') || 'https://stream.nnfz.ru';
};

function enableAudioNack(sdp) {
  const lines = sdp.split('\r\n');
  const result = [];
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
        const hasNack = lines.some(l =>
          l === `a=rtcp-fb:${pt} nack` ||
          l === `a=rtcp-fb:${pt} nack `
        );
        if (!hasNack) {
          result.push(`a=rtcp-fb:${pt} nack`);
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

  const CHECK_INTERVAL = 5000;

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isConnectingRef.current = false;
  }, [videoRef]);

  const safePlay = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (playPromiseRef.current) return;
      playPromiseRef.current = videoRef.current.play();
      await playPromiseRef.current;
      playPromiseRef.current = null;
      setStatus('playing');
    } catch (err) {
      playPromiseRef.current = null;
      if (err.name === 'NotAllowedError') {
        setStatus('playing');
      } else if (err.name !== 'AbortError') {
        console.error('Play error:', err);
      }
    }
  }, [videoRef]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;

    cleanup();
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
        if (videoRef.current && event.streams[0]) {
          if (videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            safePlay();
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        const state = pc.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          setStatus('error');
          setError('Соединение потеряно');
          reconnectTimerRef.current = setTimeout(() => connect(), 3000);
        }
      };

      const offer = await pc.createOffer();
      const enhancedSDP = enableAudioNack(offer.sdp);

      await pc.setLocalDescription({ type: 'offer', sdp: enhancedSDP });

      const serverUrl = getServerUrl();
      const whepUrl = `${serverUrl}/rtc/v1/whep/?app=live&stream=${streamKey}`;
      const answerSDP = await tauriApi.whepRequest(whepUrl, enhancedSDP);

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: answerSDP })
      );

      isConnectingRef.current = false;
    } catch (err) {
      console.error('WebRTC error:', err);
      setStatus('offline');
      setError(err.message || 'Не удалось подключиться');
      isConnectingRef.current = false;
      checkTimerRef.current = setTimeout(() => connect(), CHECK_INTERVAL);
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
    setTimeout(() => connect(), 100);
  }, [disconnect, connect]);

  const getPC = useCallback(() => pcRef.current, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return { status, error, isDemuxing, connect, disconnect, reconnect, getPC };
}

export default useWebRTC;
