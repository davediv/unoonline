/**
 * Toasts. The wording lives in `lib/toasts.ts`; this is just how they look
 * and how long they stay.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import type { Toast } from '../lib/toasts';

export function Toasts({ toasts, onExpire }: { toasts: Toast[]; onExpire: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onExpire={onExpire} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastRow({ toast, onExpire }: { toast: Toast; onExpire: (id: number) => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => onExpire(toast.id), 3600);
    return () => window.clearTimeout(id);
  }, [toast.id, onExpire]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.2, 0.9, 0.24, 1] }}
      className={`pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur ${
        toast.tone === 'warn'
          ? 'border-uno-red/40 bg-[#1b1216]/95 text-chalk'
          : 'border-edge bg-raised/95 text-chalk'
      }`}
    >
      {toast.text}
    </motion.div>
  );
}
