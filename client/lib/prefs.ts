/**
 * The handful of things the browser should remember between visits.
 *
 * Nickname and avatar so you do not retype them, and the two accessibility
 * switches so you set them once.
 */

import { AVATAR_COUNT } from '../../shared/room';

export interface Prefs {
  name: string;
  avatar: number;
  muted: boolean;
  colorblind: boolean;
  sortHand: boolean;
}

const KEY = 'uno.prefs';

export const DEFAULT_PREFS: Prefs = {
  name: '',
  avatar: 0,
  muted: false,
  colorblind: false,
  sortHand: true,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 16) : '',
      avatar:
        typeof parsed.avatar === 'number' && Number.isFinite(parsed.avatar)
          ? ((Math.trunc(parsed.avatar) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT
          : 0,
      muted: parsed.muted === true,
      colorblind: parsed.colorblind === true,
      sortHand: parsed.sortHand !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing, or storage is full. Not worth interrupting a game for.
  }
}

/** Session tokens are per room and per tab — that is what reclaims a seat. */
export function loadToken(code: string): string | null {
  try {
    return sessionStorage.getItem(`uno.token.${code}`);
  } catch {
    return null;
  }
}

export function saveToken(code: string, token: string): void {
  try {
    sessionStorage.setItem(`uno.token.${code}`, token);
  } catch {
    // Nothing to do; they will join as a new player if they refresh.
  }
}

export function clearToken(code: string): void {
  try {
    sessionStorage.removeItem(`uno.token.${code}`);
  } catch {
    // Ignore.
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
