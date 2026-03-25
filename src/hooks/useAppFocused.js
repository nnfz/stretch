import { useState, useEffect } from 'react';

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