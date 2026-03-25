// src/hooks/useStreamStats.js
import { useRef, useCallback, useEffect, useState } from 'react';

const POLL_FOCUSED = 1000;
const POLL_BACKGROUND = 30000;
const HINT_MIN = 0.03;
const HINT_MAX = 1.0;
const HINT_INITIAL = 0.03;

export default function useStreamStats(videoRef, getPC, isActive, appFocused = true) {
  const [stats, setStats] = useState({
    latency: 0, jitter: 0, packetLoss: 0,
    bitrate: 0, fps: 0, resolution: '',
  });

  const [bufferInfo, setBufferInfo] = useState({
    level: 0, target: 0, health: 'good',
    stalls: 0, dropped: 0, droppedRate: 0,
    nackCount: 0, pliCount: 0, delayHint: 30, hasData: false,
  });

  const prevBytesRef = useRef(0);
  const prevTimestampRef = useRef(0);
  const prevPacketsLostRef = useRef(0);
  const prevPacketsReceivedRef = useRef(0);

  const prev = useRef({
    jbDelay: 0, jbTarget: 0, jbEmitted: 0,
    dropped: 0, pktLost: 0, pktRecv: 0, ts: 0,
  });

  const stallCount = useRef(0);
  const lastStallTs = useRef(0);
  const sm = useRef({ level: -1, target: -1 });
  const everHadJB = useRef(false);
  const hintRef = useRef(HINT_INITIAL);

  useEffect(() => {
    if (!isActive) return;

    const video = videoRef.current;
    const onWaiting = () => {
      stallCount.current++;
      lastStallTs.current = Date.now();
    };
    video?.addEventListener('waiting', onWaiting);

    const pollMs = appFocused ? POLL_FOCUSED : POLL_BACKGROUND;

    const tick = async () => {
      const pc = getPC?.();
      if (!pc) return;

      try {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') return;
      } catch { return; }

      try {
        const raw = await pc.getStats();
        const now = Date.now();

        let latency = 0, videoJitter = 0;
        let packetsLost = 0, packetsReceived = 0;
        let bytesReceived = 0, timestamp = 0, fps = 0;
        let frameWidth = 0, frameHeight = 0;

        let jbDelay = 0, jbTarget = 0, jbEmitted = 0;
        let framesDropped = 0, freezeCount = 0;
        let nackCount = 0, pliCount = 0;
        let rtpJitter = 0, rtpPktLost = 0, rtpPktRecv = 0;
        let hasJBField = false;

        raw.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined)
              latency = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.jitter !== undefined) videoJitter = Math.round(report.jitter * 1000);
            if (report.packetsLost !== undefined) packetsLost = report.packetsLost;
            if (report.packetsReceived !== undefined) packetsReceived = report.packetsReceived;
            if (report.bytesReceived !== undefined) {
              bytesReceived = report.bytesReceived;
              timestamp = report.timestamp;
            }
            if (report.framesPerSecond !== undefined) fps = Math.round(report.framesPerSecond);
            if (report.frameWidth) frameWidth = report.frameWidth;
            if (report.frameHeight) frameHeight = report.frameHeight;

            if (report.jitterBufferDelay !== undefined) {
              hasJBField = true;
              jbDelay = report.jitterBufferDelay;
            }
            jbTarget = report.jitterBufferTargetDelay ?? 0;
            jbEmitted = report.jitterBufferEmittedCount ?? 0;
            framesDropped = report.framesDropped ?? 0;
            freezeCount = report.freezeCount ?? 0;
            nackCount = report.nackCount ?? 0;
            pliCount = report.pliCount ?? 0;
            rtpJitter = report.jitter ?? 0;
            rtpPktLost = report.packetsLost ?? 0;
            rtpPktRecv = report.packetsReceived ?? 0;
          }
        });

        // === Stats ===
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
          latency, jitter: videoJitter,
          packetLoss: Math.max(0, packetLoss),
          bitrate, fps, resolution,
        });

        // === Buffer ===
        if (video?.getVideoPlaybackQuality) {
          try {
            const q = video.getVideoPlaybackQuality();
            const vqd = q?.droppedVideoFrames ?? 0;
            if (vqd > framesDropped) framesDropped = vqd;
          } catch {}
        }

        if (hasJBField) everHadJB.current = true;

        const p = prev.current;
        const dE = jbEmitted - p.jbEmitted;
        const dD = jbDelay - p.jbDelay;
        const dT = jbTarget - p.jbTarget;
        const dt = p.ts > 0 ? (now - p.ts) / 1000 : pollMs / 1000;

        const dDropped = Math.max(0, framesDropped - p.dropped);
        const dLostBuf = Math.max(0, rtpPktLost - p.pktLost);
        const dRecvBuf = Math.max(0, rtpPktRecv - p.pktRecv);

        if (dE < 0 || dDropped < -100) {
          prev.current = {
            jbDelay, jbTarget, jbEmitted,
            dropped: framesDropped, pktLost: rtpPktLost, pktRecv: rtpPktRecv, ts: now,
          };
          return;
        }

        const hasJBData = hasJBField && dE > 0;

        let levelRaw = 0;
        if (hasJBData) levelRaw = (dD / dE) * 1000;

        if (sm.current.level < 0) sm.current.level = levelRaw;
        else if (hasJBData) sm.current.level = sm.current.level * 0.5 + levelRaw * 0.5;
        const levelMs = Math.round(Math.max(0, sm.current.level < 0 ? 0 : sm.current.level));

        let targetRaw = 0;
        if (hasJBData && dT > 0) targetRaw = (dT / dE) * 1000;
        if (targetRaw > 0) {
          if (sm.current.target < 0) sm.current.target = targetRaw;
          else sm.current.target = sm.current.target * 0.7 + targetRaw * 0.3;
        }
        const targetMs = Math.round(Math.max(0, sm.current.target < 0 ? 0 : sm.current.target));

        const droppedRate = dt > 0 ? Math.round((dDropped / dt) * 10) / 10 : 0;
        const lossRate = (dRecvBuf + dLostBuf > 0) ? dLostBuf / (dRecvBuf + dLostBuf) : 0;
        const totalStalls = Math.max(freezeCount, stallCount.current);
        const justStalled = lastStallTs.current > 0 && (now - lastStallTs.current) < 3000;

        let health = 'good';
        if (hasJBData || everHadJB.current) {
          if (p.ts > 0 && dE === 0 && hasJBField) health = 'critical';
          else if (justStalled || droppedRate > 8) health = 'critical';
          else if (droppedRate > 3 || lossRate > 0.05) health = 'low';
          else if (levelMs > 200) health = 'overflow';
          else if (droppedRate < 1 && levelMs > 5 && !justStalled) health = 'excellent';
        } else {
          if (justStalled || droppedRate > 8) health = 'critical';
          else if (droppedRate > 3) health = 'low';
        }

        let desired = HINT_MIN;
        if (droppedRate > 0) {
          const t = Math.min(droppedRate / 10, 1);
          desired = Math.max(desired, 0.05 + t * 0.95);
        }
        const since = now - lastStallTs.current;
        if (lastStallTs.current > 0) {
          if (since < 10000) desired = Math.max(desired, 1.0);
          else if (since < 20000) desired = Math.max(desired, 0.7);
          else if (since < 40000) desired = Math.max(desired, 0.4);
          else if (since < 60000) desired = Math.max(desired, 0.2);
        }
        if (lossRate > 0.01) desired = Math.max(desired, 0.15);
        if (lossRate > 0.03) desired = Math.max(desired, 0.4);
        if (lossRate > 0.05) desired = Math.max(desired, 0.7);
        if (lossRate > 0.10) desired = Math.max(desired, 1.0);
        if (rtpJitter > 0.010) desired = Math.max(desired, rtpJitter * 8);
        if (rtpJitter > 0.030) desired = Math.max(desired, 0.4);
        if (rtpJitter > 0.050) desired = Math.max(desired, 0.7);
        if (totalStalls >= 3) desired = Math.max(desired, 0.2);
        if (totalStalls >= 6) desired = Math.max(desired, 0.5);
        if (totalStalls >= 10) desired = Math.max(desired, 0.7);
        if (totalStalls >= 15) desired = Math.max(desired, 1.0);
        if (pliCount > 5) desired = Math.max(desired, 0.2);
        if (pliCount > 15) desired = Math.max(desired, 0.5);
        desired = Math.min(desired, HINT_MAX);

        if (desired > hintRef.current) hintRef.current += (desired - hintRef.current) * 0.3;
        else hintRef.current += (desired - hintRef.current) * 0.02;

        let hint = Math.round(hintRef.current * 1000) / 1000;
        hint = Math.max(HINT_MIN, Math.min(hint, HINT_MAX));

        try {
          const receivers = pc.getReceivers?.() || [];
          for (const r of receivers) {
            if (!r.track) continue;
            if (r.track.kind === 'video' && 'playoutDelayHint' in r) {
              r.playoutDelayHint = hint;
            }
          }
        } catch {}

        prev.current = {
          jbDelay, jbTarget, jbEmitted,
          dropped: framesDropped, pktLost: rtpPktLost, pktRecv: rtpPktRecv, ts: now,
        };

        setBufferInfo({
          level: levelMs, target: targetMs, health,
          stalls: totalStalls, dropped: framesDropped, droppedRate,
          nackCount, pliCount,
          delayHint: Math.round(hint * 1000),
          hasData: hasJBData || everHadJB.current,
        });
      } catch {}
    };

    const id = setInterval(tick, pollMs);
    const firstTick = setTimeout(tick, 300);

    return () => {
      clearInterval(id);
      clearTimeout(firstTick);
      video?.removeEventListener('waiting', onWaiting);
    };
  }, [videoRef, getPC, isActive, appFocused]);

  const reset = useCallback(() => {
    prevBytesRef.current = 0;
    prevTimestampRef.current = 0;
    prevPacketsLostRef.current = 0;
    prevPacketsReceivedRef.current = 0;
    prev.current = {
      jbDelay: 0, jbTarget: 0, jbEmitted: 0,
      dropped: 0, pktLost: 0, pktRecv: 0, ts: 0,
    };
    stallCount.current = 0;
    lastStallTs.current = 0;
    sm.current = { level: -1, target: -1 };
    everHadJB.current = false;
    hintRef.current = HINT_INITIAL;
    setStats({ latency: 0, jitter: 0, packetLoss: 0, bitrate: 0, fps: 0, resolution: '' });
    setBufferInfo({
      level: 0, target: 0, health: 'good',
      stalls: 0, dropped: 0, droppedRate: 0,
      nackCount: 0, pliCount: 0, delayHint: 30, hasData: false,
    });
  }, []);

  const skipToLive = useCallback(() => {
    try {
      const pc = getPC?.();
      const receivers = pc?.getReceivers?.() || [];
      for (const r of receivers) {
        if (!r.track) continue;
        if (r.track.kind === 'video' && 'playoutDelayHint' in r) r.playoutDelayHint = 0;
      }
    } catch {}
    lastStallTs.current = 0;
    sm.current = { level: -1, target: -1 };
    hintRef.current = HINT_INITIAL;
  }, [getPC]);

  return { stats, bufferInfo, reset, skipToLive };
}