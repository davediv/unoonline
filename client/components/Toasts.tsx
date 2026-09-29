/**
 * Toasts. The wording lives in `lib/toasts.ts`; this is just how they look
 * and how long they stay.
 */

import { memo, useEffect, useState } from 'react';
import type { Toast } from '../lib/toasts';

export const Toasts = memo(function Toasts({
  toasts,
  onExpire,
}: {
  toasts: Toast[];
  onExpire: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onExpire={onExpire} />
      ))}
    </div>
  );
});

function ToastRow({ toast, onExpire }: { toast: Toast; onExpire: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const exit = window.setTimeout(() => setExiting(true), 3600);
    const remove = window.setTimeout(() => onExpire(toast.id), 3820);
    return () => {
      window.clearTimeout(exit);
      window.clearTimeout(remove);
    };
  }, [toast.id, onExpire]);

  return (
    <div className={`toast-slot ${exiting ? 'toast-slot-exit' : ''}`}>
      <div
        className={`toast-row pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur ${
          toast.tone === 'warn'
            ? 'border-uno-red/40 bg-[#1b1216]/95 text-chalk'
            : 'border-edge bg-raised/95 text-chalk'
        }`}
      >
        {toast.text}
      </div>
    </div>
  );
}
