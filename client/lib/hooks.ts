import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The wall clock, treated as what it is: an external source React subscribes
 * to. One shared value, read straight through `useSyncExternalStore`, and no
 * interval at all while nothing is counting down — so an idle table does not
 * re-render ten times a second.
 */
let clock = Date.now();

export function useTicker(active: boolean, intervalMs = 100): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return () => undefined;
      clock = Date.now();
      const id = window.setInterval(() => {
        clock = Date.now();
        onChange();
      }, intervalMs);
      return () => window.clearInterval(id);
    },
    [active, intervalMs],
  );

  const read = () => clock;
  return useSyncExternalStore(subscribe, read, read);
}

/** Tracks a media query, so layout can branch without duplicating the DOM. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Copies text and reports whether it worked, for the "Copied" state. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = (text: string) => {
    const done = () => setCopied(true);

    const fallback = () => {
      // Older Safari, and any context where the clipboard API is blocked.
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        // Nothing more to try; the code is on screen to be read out.
      }
      field.remove();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  };

  return [copied, copy];
}
