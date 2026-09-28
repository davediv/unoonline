import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/** When the last automatic reload happened, so an outage cannot loop. */
const STALE_RELOAD_KEY = 'uno.staleReloadAt';

/**
 * A tab opened before a deploy still asks for the previous build's chunks,
 * which are gone — and a browser never retries a module import that failed.
 * Entering a room would leave a blank page, so reload once instead: the URL
 * already names the room, and the new build opens it. Only on a room URL (a
 * failed prefetch on the way in is harmless), at most once a minute, and not
 * at all when storage is unavailable to remember that.
 */
window.addEventListener('vite:preloadError', (event) => {
  if (!/\/r\/[^/]+\/?$/.test(location.pathname)) return;
  try {
    const last = Number(sessionStorage.getItem(STALE_RELOAD_KEY)) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
