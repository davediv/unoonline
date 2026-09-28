import { useCallback, useState } from 'react';

/**
 * Every failure the server can return has a sentence written for it here, in
 * the interface's voice: what happened, and what to do about it. A raw code
 * only ever reaches a player if the server invents one we have not met.
 */
const WORDING: Record<string, string> = {
  no_such_room: 'No room with that code. Check the letters and try again.',
  room_full: 'That table is full. You can watch instead.',
  bad_message: 'Something got garbled on the way to the table.',
  slow_down: 'Easy — that was a lot of clicks at once.',
  not_host: 'Only the host can change that.',
  not_ready: 'Everyone has to be ready before the game starts.',
  not_enough_players: 'You need at least two players. Add a bot to fill a seat.',
  in_progress: 'Rules are locked once the game has started.',
  spectating: 'You are watching this one. You will be dealt in next game.',
  not_your_turn: 'Not your turn yet.',
  illegal_card: 'That card will not go there.',
  must_play_drawn: 'You can only play the card you just drew.',
  already_drew: 'Play the card you drew, or keep it and pass.',
  resolve_first: 'Finish the choice on screen first.',
  must_draw: 'You have cards to pick up first.',
  cannot_stack: 'That will not stack on this one.',
  no_self_jump: 'You cannot jump in on your own card.',
  no_wild_jump: 'You cannot jump in on a wild.',
  not_exact_match: 'Jumping in needs the same colour and the same value.',
  nothing_to_catch: 'Nobody is on one card right now.',
  already_accused: 'You have already called that one.',
  window_closed: 'Too late — that moment has passed.',
  no_uno_window: 'You are not on one card.',
  already_called: 'You already called it.',
  nothing_to_challenge: 'There is nothing to challenge.',
  replaced: 'You opened this room in another tab. This one has stopped.',
  removed: 'The host removed you from the room.',
  no_code_available: 'Could not get a room code. Try again in a moment.',
};

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

export function toastText(code: string, fallback: string): string {
  return WORDING[code] ?? fallback ?? 'Something went wrong.';
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Stable, because each toast's expiry timer depends on `dismiss`: a new one
  // every render would restart the timer on every frame the room sends.
  const push = useCallback((text: string, tone: Toast['tone'] = 'warn') => {
    setToasts((current) => [...current, { id: Date.now() + Math.random(), text, tone }].slice(-3));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
