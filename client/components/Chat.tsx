/**
 * Chat, and the running commentary.
 *
 * The same panel carries both: what people type and what the table did.
 * System lines are written by the server so a late arrival sees the same
 * history as everyone else.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar } from './Avatar';
import type { ChatMessage } from '../../shared/protocol';
import { EMOTES, MAX_CHAT_LENGTH } from '../../shared/protocol';

interface ChatProps {
  messages: ChatMessage[];
  open: boolean;
  canTalk: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  onEmote: (index: number) => void;
}

export function Chat({ messages, open, canTalk, onClose, onSend, onEmote }: ChatProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.22, ease: [0.2, 0.9, 0.24, 1] }}
          className="fixed inset-x-0 bottom-0 z-30 flex h-[62dvh] flex-col border-t border-edge bg-raised/95 backdrop-blur sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-80 sm:border-t-0 sm:border-l"
          aria-label="Chat"
        >
          <header className="flex items-center justify-between border-b border-edge px-4 py-3">
            <h2 className="text-sm font-semibold tracking-wide text-chalk-dim uppercase">Table talk</h2>
            <button
              onClick={onClose}
              aria-label="Close chat"
              className="rounded-lg border border-edge px-2.5 py-1 text-sm text-chalk-dim transition hover:border-chalk-faint hover:text-chalk"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
            {messages.map((message) =>
              message.kind === 'system' ? (
                <p key={message.id} className="text-xs leading-relaxed text-chalk-faint">
                  {message.text}
                </p>
              ) : (
                <div key={message.id} className="flex items-start gap-2">
                  <Avatar index={message.avatar ?? 0} size={24} className="mt-0.5 shrink-0" />
                  <p className="min-w-0 text-sm break-words text-chalk">
                    <span className="mr-1.5 font-semibold text-chalk-dim">{message.name}</span>
                    <span className={message.kind === 'emote' ? 'text-2xl leading-none' : ''}>
                      {message.text}
                    </span>
                  </p>
                </div>
              ),
            )}
            {messages.length === 0 && (
              <p className="text-sm text-chalk-faint">Nothing said yet.</p>
            )}
            <div ref={bottomRef} />
          </div>

          {canTalk && (
            <div className="border-t border-edge p-3">
              <div className="mb-2 flex justify-between gap-1">
                {EMOTES.map((emote, index) => (
                  <button
                    key={emote.glyph}
                    onClick={() => onEmote(index)}
                    aria-label={emote.label}
                    title={emote.label}
                    className="flex-1 rounded-lg py-1.5 text-xl transition hover:bg-chalk/10"
                  >
                    {emote.glyph}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  onSend(text);
                  setDraft('');
                }}
              >
                <label htmlFor="chat-input" className="sr-only">
                  Say something
                </label>
                <input
                  id="chat-input"
                  value={draft}
                  maxLength={MAX_CHAT_LENGTH}
                  placeholder="Say something"
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-edge bg-felt px-3 py-2 text-sm text-chalk placeholder:text-chalk-faint focus:border-chalk-dim focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-edge px-3 py-2 text-sm font-semibold text-chalk transition hover:border-chalk-faint"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
