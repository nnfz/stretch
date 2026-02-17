import { useRef, useCallback, useEffect, useState } from 'react';

const POLL_MS = 500;
const HINT_MIN = 0.03;
const HINT_MAX = 1.0;
const HINT_INITIAL = 0.03;

export default function useAdaptiveBuffer(videoRef, getPC, isActive) {
  const [bufferInfo, setBufferInfo] = useState({
    level: 0,
    target: 0,
    health: 'good',
    stalls: 0,
    dropped: 0,
    droppedRate: 0,
    nackCount: 0,
    pliCount: 0,
    delayHint: 30,
    hasData: false,
  });

  const prev = useRef({
    jbDelay: 0,
    jbTarget: 0,
    jbEmitted: 0,
    dropped: 0,
    pktLost: 0,
    pktRecv: 0,
    ts: 0,
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

    const tick = async () => {
      const pc = getPC?.();
      if (!pc) return;

      try {
        if (pc.connectionState === 'closed' ||
            pc.connectionState === 'failed') return;
      } catch (e) { return; }

      try {
        const raw = await pc.getStats();
        const now = Date.now();
        const p = prev.current;

        let jbDelay = 0, jbTarget = 0, jbEmitted = 0;
        let framesDropped = 0, freezeCount = 0;
        let nackCount = 0, pliCount = 0;
        let jitter = 0, pktLost = 0, pktRecv = 0;
        let hasJBField = false;

        raw.forEach(r => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;

          if (r.jitterBufferDelay !== undefined) {
            hasJBField = true;
            jbDelay = r.jitterBufferDelay;
          }
          jbTarget  = r.jitterBufferTargetDelay  ?? 0;
          jbEmitted = r.jitterBufferEmittedCount ?? 0;
          framesDropped = r.framesDropped  ?? 0;
          freezeCount   = r.freezeCount    ?? 0;
          nackCount     = r.nackCount      ?? 0;
          pliCount      = r.pliCount       ?? 0;
          jitter        = r.jitter         ?? 0;
          pktLost       = r.packetsLost    ?? 0;
          pktRecv       = r.packetsReceived ?? 0;
        });

        if (video?.getVideoPlaybackQuality) {
          try {
            const q = video.getVideoPlaybackQuality();
            const vqd = q?.droppedVideoFrames ?? 0;
            if (vqd > framesDropped) framesDropped = vqd;
          } catch (e) {}
        }

        if (hasJBField) everHadJB.current = true;

        const dE = jbEmitted - p.jbEmitted;
        const dD = jbDelay   - p.jbDelay;
        const dT = jbTarget  - p.jbTarget;
        const dt = p.ts > 0 ? (now - p.ts) / 1000 : POLL_MS / 1000;

        const dDropped = Math.max(0, framesDropped - p.dropped);
        const dLost    = Math.max(0, pktLost  - p.pktLost);
        const dRecv    = Math.max(0, pktRecv  - p.pktRecv);

        if (dE < 0 || dDropped < -100) {
          prev.current = {
            jbDelay, jbTarget, jbEmitted,
            dropped: framesDropped, pktLost, pktRecv, ts: now,
          };
          return;
        }

        const hasJBData = hasJBField && dE > 0;

        let levelRaw = 0;
        if (hasJBData) {
          levelRaw = (dD / dE) * 1000;
        }

        if (sm.current.level < 0) {
          sm.current.level = levelRaw;
        } else if (hasJBData) {
          sm.current.level = sm.current.level * 0.5 + levelRaw * 0.5;
        }
        const levelMs = Math.round(Math.max(0, sm.current.level < 0 ? 0 : sm.current.level));

        let targetRaw = 0;
        if (hasJBData && dT > 0) {
          targetRaw = (dT / dE) * 1000;
        }
        if (targetRaw > 0) {
          if (sm.current.target < 0) sm.current.target = targetRaw;
          else sm.current.target = sm.current.target * 0.7 + targetRaw * 0.3;
        }
        const targetMs = Math.round(Math.max(0, sm.current.target < 0 ? 0 : sm.current.target));

        const droppedRate = dt > 0
          ? Math.round((dDropped / dt) * 10) / 10
          : 0;

        const lossRate = (dRecv + dLost > 0) ? dLost / (dRecv + dLost) : 0;
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
          if (since < 10000)      desired = Math.max(desired, 1.0);
          else if (since < 20000) desired = Math.max(desired, 0.7);
          else if (since < 40000) desired = Math.max(desired, 0.4);
          else if (since < 60000) desired = Math.max(desired, 0.2);
        }

        if (lossRate > 0.01) desired = Math.max(desired, 0.15);
        if (lossRate > 0.03) desired = Math.max(desired, 0.4);
        if (lossRate > 0.05) desired = Math.max(desired, 0.7);
        if (lossRate > 0.10) desired = Math.max(desired, 1.0);

        if (jitter > 0.010) desired = Math.max(desired, jitter * 8);
        if (jitter > 0.030) desired = Math.max(desired, 0.4);
        if (jitter > 0.050) desired = Math.max(desired, 0.7);

        if (totalStalls >= 3)  desired = Math.max(desired, 0.2);
        if (totalStalls >= 6)  desired = Math.max(desired, 0.5);
        if (totalStalls >= 10) desired = Math.max(desired, 0.7);
        if (totalStalls >= 15) desired = Math.max(desired, 1.0);

        if (pliCount > 5)  desired = Math.max(desired, 0.2);
        if (pliCount > 15) desired = Math.max(desired, 0.5);

        desired = Math.min(desired, HINT_MAX);

        if (desired > hintRef.current) {
          hintRef.current += (desired - hintRef.current) * 0.3;
        } else {
          hintRef.current += (desired - hintRef.current) * 0.02;
        }

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
        } catch (e) {}

        prev.current = {
          jbDelay, jbTarget, jbEmitted,
          dropped: framesDropped, pktLost, pktRecv,
          ts: now,
        };

        setBufferInfo({
          level: levelMs,
          target: targetMs,
          health,
          stalls: totalStalls,
          dropped: framesDropped,
          droppedRate,
          nackCount,
          pliCount,
          delayHint: Math.round(hint * 1000),
          hasData: hasJBData || everHadJB.current,
        });
      } catch (e) {}
    };

    const id = setInterval(tick, POLL_MS);
    const firstTick = setTimeout(tick, 200);

    return () => {
      clearInterval(id);
      clearTimeout(firstTick);
      video?.removeEventListener('waiting', onWaiting);
    };
  }, [videoRef, getPC, isActive]);

  const reset = useCallback(() => {
    prev.current = {
      jbDelay: 0, jbTarget: 0, jbEmitted: 0,
      dropped: 0, pktLost: 0, pktRecv: 0, ts: 0,
    };
    stallCount.current = 0;
    lastStallTs.current = 0;
    sm.current = { level: -1, target: -1 };
    everHadJB.current = false;
    hintRef.current = HINT_INITIAL;
    setBufferInfo({
      level: 0, target: 0, health: 'good',
      stalls: 0, dropped: 0, droppedRate: 0,
      nackCount: 0, pliCount: 0, delayHint: 30,
      hasData: false,
    });
  }, []);

  const skipToLive = useCallback(() => {
    try {
      const pc = getPC?.();
      const receivers = pc?.getReceivers?.() || [];
      for (const r of receivers) {
        if (!r.track) continue;
        if (r.track.kind === 'video' && 'playoutDelayHint' in r) {
          r.playoutDelayHint = 0;
        }
      }
    } catch (e) {}
    lastStallTs.current = 0;
    sm.current = { level: -1, target: -1 };
    hintRef.current = HINT_INITIAL;
  }, [getPC]);

  return { bufferInfo, reset, skipToLive };
}
