import { useLayoutEffect, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const inertLocks = new WeakMap<HTMLElement, { count: number; wasInert: boolean }>();

/** Keep a game decision as the only keyboard destination until it closes. */
export function useModalFocus(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const locked: HTMLElement[] = [];

    // A modal is nested inside the table, so inert its siblings at every level.
    for (let node: HTMLElement = modal; node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        const lock = inertLocks.get(sibling);
        if (lock) lock.count += 1;
        else inertLocks.set(sibling, { count: 1, wasInert: sibling.inert });
        sibling.setAttribute('inert', '');
        locked.push(sibling);
      }
      if (node.parentElement === document.body) break;
    }

    const choices = () => Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => !element.closest('[inert]') && element.getClientRects().length > 0);
    (choices()[0] ?? modal).focus();

    const onFocus = (event: FocusEvent) => {
      if (!modal.contains(event.target as Node)) (choices()[0] ?? modal).focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = choices();
      if (items.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey, true);
      for (const sibling of locked) {
        const lock = inertLocks.get(sibling);
        if (!lock) continue;
        lock.count -= 1;
        if (lock.count === 0) {
          if (!lock.wasInert) sibling.removeAttribute('inert');
          inertLocks.delete(sibling);
        }
      }
      if (previous?.isConnected && !previous.inert) previous.focus();
    };
  }, [ref]);
}
