import { useState, useEffect } from 'react';

/**
 * Returns true when the app window is visible and focused.
 * When the user is in a game (app in background), returns false
 * so we can throttle expensive timers and reduce CPU/GPU load.
 */
export default function useAppFocused() {
  const [focused, setFocused] = useState(
    () => document.visibilityState === 'visible' && document.hasFocus()
  );

  useEffect(() => {
    const update = () => {
      setFocused(document.visibilityState === 'visible' && document.hasFocus());
    };

    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);

    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return focused;
}
