/**
 * Twelve avatars, drawn in code.
 *
 * Deliberately kept off the four game colours — a player's avatar should
 * never read as "the red player" when red is also a card colour. These are
 * muted and earthy so the cards stay the loudest thing on the table.
 */

import { AVATAR_COUNT } from '../../shared/room';

const FACES = [
  { skin: '#7fd1c1', back: '#12433c', shape: 'round', eyes: 'dot', extra: 'antenna' },
  { skin: '#f0a68c', back: '#4a2018', shape: 'square', eyes: 'wide', extra: 'ears' },
  { skin: '#b8a4f0', back: '#2a1e4d', shape: 'hex', eyes: 'visor', extra: 'none' },
  { skin: '#e8c86a', back: '#463618', shape: 'round', eyes: 'sleepy', extra: 'horns' },
  { skin: '#8fb8e8', back: '#17304d', shape: 'square', eyes: 'dot', extra: 'crest' },
  { skin: '#e58ba8', back: '#4a1c2c', shape: 'round', eyes: 'wide', extra: 'none' },
  { skin: '#9dd17f', back: '#22401a', shape: 'hex', eyes: 'dot', extra: 'ears' },
  { skin: '#d9d2c4', back: '#3a352c', shape: 'round', eyes: 'visor', extra: 'antenna' },
  { skin: '#7fc4d1', back: '#123c45', shape: 'square', eyes: 'sleepy', extra: 'none' },
  { skin: '#f0b0d8', back: '#45204a', shape: 'hex', eyes: 'wide', extra: 'crest' },
  { skin: '#c4b489', back: '#3d3520', shape: 'round', eyes: 'dot', extra: 'horns' },
  { skin: '#a0a8c8', back: '#22273d', shape: 'square', eyes: 'sleepy', extra: 'ears' },
] as const;

function headPath(shape: (typeof FACES)[number]['shape']) {
  switch (shape) {
    case 'round':
      return <circle cx={24} cy={26} r={13} />;
    case 'square':
      return <rect x={11} y={13} width={26} height={26} rx={7} />;
    case 'hex':
      return <path d="M24 12 L35 19 L35 33 L24 40 L13 33 L13 19 Z" />;
  }
}

function eyes(kind: (typeof FACES)[number]['eyes'], ink: string) {
  switch (kind) {
    case 'dot':
      return (
        <>
          <circle cx={19} cy={25} r={2.4} fill={ink} />
          <circle cx={29} cy={25} r={2.4} fill={ink} />
        </>
      );
    case 'wide':
      return (
        <>
          <circle cx={19} cy={25} r={4} fill="#ffffff" />
          <circle cx={29} cy={25} r={4} fill="#ffffff" />
          <circle cx={19.8} cy={25.4} r={2} fill={ink} />
          <circle cx={29.8} cy={25.4} r={2} fill={ink} />
        </>
      );
    case 'visor':
      return <rect x={14} y={22} width={20} height={6} rx={3} fill={ink} />;
    case 'sleepy':
      return (
        <>
          <path d="M15.5 25.5 q3.5 -3 7 0" stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <path d="M25.5 25.5 q3.5 -3 7 0" stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </>
      );
  }
}

function extra(kind: (typeof FACES)[number]['extra'], skin: string, ink: string) {
  switch (kind) {
    case 'antenna':
      return (
        <>
          <line x1={24} y1={13} x2={24} y2={7} stroke={skin} strokeWidth={2.2} strokeLinecap="round" />
          <circle cx={24} cy={6} r={2.6} fill={skin} />
        </>
      );
    case 'ears':
      return (
        <>
          <circle cx={9} cy={26} r={4} fill={skin} />
          <circle cx={39} cy={26} r={4} fill={skin} />
        </>
      );
    case 'horns':
      return (
        <>
          <path d="M14 15 L11 8 L18 12 Z" fill={skin} />
          <path d="M34 15 L37 8 L30 12 Z" fill={skin} />
        </>
      );
    case 'crest':
      return <path d="M17 13 q7 -9 14 0 Z" fill={ink} opacity={0.35} />;
    case 'none':
      return null;
  }
}

export function Avatar({
  index,
  size = 40,
  className,
  ring,
}: {
  index: number;
  size?: number;
  className?: string;
  /** Draws a coloured ring, used to mark whose turn it is. */
  ring?: string;
}) {
  const face = FACES[((index % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT];
  const ink = face.back;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx={24} cy={24} r={23} fill={face.back} />
      <g fill={face.skin}>{extra(face.extra, face.skin, ink)}</g>
      <g fill={face.skin}>{headPath(face.shape)}</g>
      {eyes(face.eyes, ink)}
      <path d="M20 32.5 q4 2.6 8 0" stroke={ink} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.75} />
      {ring && <circle cx={24} cy={24} r={22} fill="none" stroke={ring} strokeWidth={3} />}
    </svg>
  );
}
