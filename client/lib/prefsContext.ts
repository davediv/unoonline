import { createContext, useContext } from 'react';
import { DEFAULT_PREFS, type Prefs } from './prefs';

export interface PrefsStore {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
}

export const PrefsContext = createContext<PrefsStore>({
  prefs: DEFAULT_PREFS,
  update: () => {},
});

export function usePrefs(): PrefsStore {
  return useContext(PrefsContext);
}
