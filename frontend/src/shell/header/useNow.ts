import { useEffect, useState } from 'react';
import type { RunClock } from '../store';

/**
 * Date.now(), once a second while `active` (0 until the first tick). A clock that adds one a second
 * drifts when the page is busy or hidden; one that reads the wall clock does not. It stands down while
 * the page is hidden (the window in the tray, rule 12) and reads the clock again the moment it shows.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [active]);
  return now;
}

/** Whole seconds the run or recording on now has gone, without the time Pause steps held it. */
export function runSeconds(clock: RunClock, now: number): number {
  if (!clock.startedAt || now < clock.startedAt) return 0;
  const held = clock.pausedSince ? Math.max(0, now - clock.pausedSince) : 0;
  return Math.max(0, Math.floor((now - clock.startedAt - clock.pausedMs - held) / 1000));
}
