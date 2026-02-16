import { useState, useCallback, useRef, useEffect } from 'react';

const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const WHEP_ENDPOINT = isDev ? '/rtc/v1/whep/' : 'https://stream.nnfz.ru/rtc/v1/whep/';
const CHECK_INTERVAL = 5000;

function useWebRTC(videoRef, streamKey) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [isDemuxing, setIsDemuxing] = useState(false);
  
  const pcRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const checkTimerRef = useRef(null);
  const isConnectingRef = useRef(false);
  const playPromiseRef = useRef(null);

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
      // Если уже есть активный промис play, не запускаем новый
      if (playPromiseRef.current) return;
      
      playPromiseRef.current = videoRef.current.play();
      await playPromiseRef.current;
      playPromiseRef.current = null;
      setStatus('playing');
    } catch (err) {
      playPromiseRef.current = null;
      if (err.name === 'NotAllowedError') {
        console.warn('Autoplay blocked, waiting for user interaction');
        setStatus('playing'); // Считаем, что мы в эфире, просто на паузе
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
      await pc.setLocalDescription(offer);

      const url = `${WHEP_ENDPOINT}?app=live&stream=${streamKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });

      if (!response.ok) throw new Error(`WHEP вернул статус ${response.status}`);

      const answerSDP = await response.text();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSDP }));

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

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return { status, error, isDemuxing, connect, disconnect, reconnect };
}

export default useWebRTC;
