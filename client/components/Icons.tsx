/**
 * The handful of interface icons, drawn to match the cards rather than
 * borrowed from the system emoji font — which renders differently on every
 * platform and looks like clip art next to the card art.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-4 w-4',
  'aria-hidden': true,
  focusable: false as const,
};

export function SoundOnIcon() {
  return (
    <svg {...base}>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.6 6.6a7.5 7.5 0 0 1 0 10.8" />
    </svg>
  );
}

export function SoundOffIcon() {
  return (
    <svg {...base}>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" />
      <path d="m16.5 10 4 4" />
      <path d="m20.5 10-4 4" />
    </svg>
  );
}

/** Colour shapes: the circle/triangle/square/diamond set, in miniature. */
export function ShapesIcon() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="7.5" r="3.2" />
      <path d="M16.5 4.3 19.7 10.7 13.3 10.7 Z" />
      <rect x="4.3" y="14" width="6.4" height="6.4" rx="1" />
      <path d="M16.5 13.6 19.9 17 16.5 20.4 13.1 17 Z" />
    </svg>
  );
}

export function SortIcon() {
  return (
    <svg {...base}>
      <path d="M7 4v16" />
      <path d="m4 17 3 3 3-3" />
      <path d="M17 20V4" />
      <path d="m14 7 3-3 3 3" />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg {...base}>
      <path d="M20.5 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.4A7.5 7.5 0 1 1 20.5 12z" />
    </svg>
  );
}
