// Remaining time is based on completed work in the current analysis pass.
// Recheck candidates are unknown during the scan, so its estimate never claims
// to include that later pass. No engine or saved-review state is changed here.
const PHASE_ORDER = { scan: 0, recheck: 1, complete: 2 };
const validCount = value => Number.isInteger(value) && value >= 0 && value <= 100_000;

function duration(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 10) return `${seconds} sec`;
  if (seconds < 60) return `${Math.ceil(seconds / 5) * 5} sec`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} hr`;
}

/** Create one estimator immediately before starting each new full review. */
export function createReviewProgressEstimator({ moveTimeMs = 150, smartAnalysis = false,
  now = () => globalThis.performance?.now() ?? Date.now() } = {}) {
  const selectedTime = Math.max(50, Math.min(5000, Math.round(Number(moveTimeMs) || 150)));
  const smart = smartAnalysis === true;
  const scanTime = smart ? Math.min(selectedTime, 150) : selectedTime;
  const recheckTime = Math.max(500, Math.min(selectedTime, 3000));
  let phase = null, completed = 0, total = 0, lastTime = null, rate = scanTime;
  let snapshot = { phase: 'starting', remainingMs: null, text: 'Estimating time…', complete: false };
  const time = () => { try { const value = now(); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const result = () => ({ ...snapshot });
  return {
    update(progress) {
      if (!progress || typeof progress !== 'object' || snapshot.complete) return result();
      const nextPhase = progress.phase ?? 'scan';
      if (!Object.hasOwn(PHASE_ORDER, nextPhase) || phase && PHASE_ORDER[nextPhase] < PHASE_ORDER[phase]) return result();
      if (nextPhase === 'complete') {
        phase = nextPhase;
        snapshot = { phase, remainingMs: null, text: 'Finishing review…', complete: true };
        return result();
      }
      const nextCompleted = progress.phaseCompleted ?? progress.completed;
      const nextTotal = progress.phaseTotal ?? progress.total;
      if (!validCount(nextCompleted) || !validCount(nextTotal) || nextTotal === 0 || nextCompleted > nextTotal) return result();
      if (nextPhase === phase && nextCompleted < completed) return result();
      const stamp = time();
      if (nextPhase !== phase) {
        phase = nextPhase; rate = phase === 'recheck' ? recheckTime : scanTime;
        // The first event can include engine startup. Begin observation here
        // instead of treating initialization as the cost of every position.
        completed = nextCompleted; total = nextTotal; lastTime = stamp;
      } else {
        const advanced = nextCompleted - completed;
        if (advanced > 0) {
          if (stamp !== null && lastTime !== null && stamp >= lastTime) {
            const observed = (stamp - lastTime) / advanced;
            // Adapt to actual throughput without one fast terminal position or
            // one slow search making the estimate swing immediately.
            rate = Math.max(1, rate * 0.65 + observed * 0.35);
          }
          if (stamp !== null && (lastTime === null || stamp >= lastTime)) lastTime = stamp;
          completed = nextCompleted;
        }
        total = nextTotal;
      }
      const remaining = total - completed;
      if (remaining === 0) {
        const choosingRechecks = smart && phase === 'scan';
        snapshot = { phase, remainingMs: null, text: choosingRechecks ? 'Choosing key moves to recheck…' : 'Finishing review…', complete: !choosingRechecks };
      } else {
        const remainingMs = Math.max(1, Math.ceil(rate * remaining));
        const suffix = smart && phase === 'scan' ? ' in first pass' : phase === 'recheck' ? ' in recheck' : '';
        snapshot = { phase, remainingMs, text: `About ${duration(remainingMs)} left${suffix}`, complete: false };
      }
      return result();
    },
  };
}
