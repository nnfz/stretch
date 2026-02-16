// hooks/useAudioDiag.js
import { useEffect, useRef } from 'react';

export default function useAudioDiag(getPC, isActive) {
  const prevRef = useRef({});

  useEffect(() => {
    if (!isActive) return;

    const tick = async () => {
      const pc = getPC?.();
      if (!pc) return;

      try {
        const stats = await pc.getStats();
        const p = prevRef.current;

        stats.forEach(r => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'audio') return;

          const dConcealed = (r.concealedSamples || 0) - (p.concealedSamples || 0);
          const dEvents = (r.concealmentEvents || 0) - (p.concealmentEvents || 0);
          const dAccel = (r.removedSamplesForAcceleration || 0) - (p.removedSamplesForAcceleration || 0);
          const dDecel = (r.insertedSamplesForDeceleration || 0) - (p.insertedSamplesForDeceleration || 0);
          const dLost = (r.packetsLost || 0) - (p.packetsLost || 0);
          const dRecv = (r.packetsReceived || 0) - (p.packetsReceived || 0);

          console.log(
            `[AUDIO DIAG]`,
            `lost: ${r.packetsLost} (+${dLost})`,
            `| recv: ${r.packetsReceived} (+${dRecv})`,
            `| jitter: ${((r.jitter || 0) * 1000).toFixed(1)}ms`,
            `| concealed: +${dConcealed} (events: +${dEvents})`,
            `| accel: +${dAccel}`,
            `| decel: +${dDecel}`,
            `| jbDelay: ${((r.jitterBufferDelay || 0) * 1000).toFixed(0)}ms`,
            `| jbEmitted: ${r.jitterBufferEmittedCount || 0}`,
            `| jbMinDelay: ${((r.jitterBufferMinimumDelay || 0) * 1000).toFixed(0)}ms`,
            `| jbTargetDelay: ${((r.jitterBufferTargetDelay || 0) * 1000).toFixed(0)}ms`
          );

          prevRef.current = {
            concealedSamples: r.concealedSamples || 0,
            concealmentEvents: r.concealmentEvents || 0,
            removedSamplesForAcceleration: r.removedSamplesForAcceleration || 0,
            insertedSamplesForDeceleration: r.insertedSamplesForDeceleration || 0,
            packetsLost: r.packetsLost || 0,
            packetsReceived: r.packetsReceived || 0,
          };
        });
      } catch (e) {}
    };

    const id = setInterval(tick, 2000);
    setTimeout(tick, 1000);

    return () => clearInterval(id);
  }, [getPC, isActive]);
}