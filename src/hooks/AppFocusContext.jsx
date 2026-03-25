import { createContext, useContext } from 'react';
import useAppFocused from './useAppFocused';

const AppFocusContext = createContext(true);

export function AppFocusProvider({ children }) {
  const focused = useAppFocused();
  return (
    <AppFocusContext.Provider value={focused}>
      {children}
    </AppFocusContext.Provider>
  );
}

export function useAppFocus() {
  return useContext(AppFocusContext);
}