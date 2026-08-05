/**
 * The cards, drawn from scratch in SVG.
 *
 * Geometry, not glyphs: the numerals are type (every device has digits), but
 * every symbol — the bar through the Skip, the paired Reverse arrows, the
 * little stacked cards on a Draw Two — is drawn as paths, so a card looks the
 * same on a phone as it does on a laptop and never depends on a font shipping
 * an arrow.
 *
 * The oval is the card's signature shape. It carries the value, it carries
 * the four colours on a Wild, and it is what makes a stack of these read as
 * a deck at a glance.
 */

import type { Card, Color } from '../../shared/types';
import { cardLabel } from '../../shared/deck';
import { CARD_COLORS, CARD_COLORS_DEEP } from '../lib/colors';

const WILD_FIELD = '#12151b';
const WILD_FIELD_DEEP = '#000000';
const QUADRANTS: Color[] = ['red', 'blue', 'yellow', 'green'];

const W = 100;
const H = 150;

interface CardFaceProps {
  card: Card;
  /** Adds a shape per colour for players who need more than hue. */
  colorblind?: boolean;
  className?: string;
}

/**
 * The shape that identifies a colour when hue alone will not do it.
 * Consistent everywhere in the app: circle red, triangle yellow, square
 * green, diamond blue.
 */
export function ColorGlyph({ color, size = 12, fill = '#ffffff' }: { color: Color; size?: number; fill?: string }) {
  const half = size / 2;
  switch (color) {
    case 'red':
      return <circle cx={0} cy={0} r={half} fill={fill} />;
    case 'yellow':
      return <path d={`M0 ${-half} L${half} ${half} L${-half} ${half} Z`} fill={fill} />;
    case 'green':
      return <rect x={-half} y={-half} width={size} height={size} fill={fill} />;
    case 'blue':
      return <path d={`M0 ${-half} L${half} 0 L0 ${half} L${-half} 0 Z`} fill={fill} />;
  }
}

/** A stem with a triangular head, pointing up, centred on the origin. */
const ARROW = 'M -3.2 13 L -3.2 -3 L -9 -3 L 0 -15 L 9 -3 L 3.2 -3 L 3.2 13 Z';

function SkipMark({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={color} strokeWidth={4.5} fill="none">
      <circle cx={0} cy={0} r={13} />
      <line x1={-9.5} y1={9.5} x2={9.5} y2={-9.5} strokeLinecap="round" />
    </g>
  );
}

function ReverseMark({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
      <path d={ARROW} transform="translate(-8 0)" />
      <path d={ARROW} transform="translate(8 0) rotate(180)" />
    </g>
  );
}

/** Two little cards, offset — what a Draw Two hands you. */
function DrawTwoMark({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={-13} y={-14} width={16} height={24} rx={3} fill="#ffffff" stroke={color} strokeWidth={2.5} transform="rotate(-14 -5 -2)" />
      <rect x={-3} y={-10} width={16} height={24} rx={3} fill={color} stroke="#ffffff" strokeWidth={2.5} transform="rotate(10 5 2)" />
    </g>
  );
}

/** Four little cards, one of each colour — a Wild Draw Four. */
function DrawFourMark({ x, y, scale }: { x: number; y: number; scale: number }) {
  const cards: Array<{ color: Color; dx: number; dy: number; rotate: number }> = [
    { color: 'red', dx: -10, dy: -2, rotate: -18 },
    { color: 'blue', dx: -3.5, dy: -5, rotate: -6 },
    { color: 'yellow', dx: 3.5, dy: -5, rotate: 6 },
    { color: 'green', dx: 10, dy: -2, rotate: 18 },
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {cards.map((c) => (
        <rect
          key={c.color}
          x={-5.5}
          y={-11}
          width={11}
          height={20}
          rx={2.5}
          fill={CARD_COLORS[c.color]}
          stroke="#ffffff"
          strokeWidth={1.8}
          transform={`translate(${c.dx} ${c.dy}) rotate(${c.rotate})`}
        />
      ))}
    </g>
  );
}

/** The four colours quartered inside the oval — a Wild. */
function WildQuarters({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(-20)`}>
      <clipPath id="oval-clip">
        <ellipse cx={0} cy={0} rx={41} ry={25} />
      </clipPath>
      <g clipPath="url(#oval-clip)">
        {QUADRANTS.map((color, index) => {
          const left = index % 2 === 0;
          const top = index < 2;
          return (
            <rect
              key={color}
              x={left ? -45 : 0}
              y={top ? -30 : 0}
              width={45}
              height={30}
              fill={CARD_COLORS[color]}
            />
          );
        })}
      </g>
      <ellipse cx={0} cy={0} rx={41} ry={25} fill="none" stroke="#ffffff" strokeWidth={3} />
    </g>
  );
}

/** A digit or "+n", set heavy and given an embossed shadow. */
function Numeral({
  text,
  x,
  y,
  size,
  fill,
  shadow,
}: {
  text: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  shadow?: string;
}) {
  const common = {
    x,
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const,
    fontFamily: "'Helvetica Neue', 'Segoe UI', Inter, system-ui, sans-serif",
    fontWeight: 900,
    fontSize: size,
    letterSpacing: '-0.04em',
    // Fattens the glyph whatever weight the platform actually has.
    paintOrder: 'stroke' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <>
      {shadow && (
        <text {...common} y={y + size * 0.055} fill={shadow} stroke={shadow} strokeWidth={size * 0.09}>
          {text}
        </text>
      )}
      <text {...common} y={y} fill={fill} stroke={fill} strokeWidth={size * 0.07}>
        {text}
      </text>
    </>
  );
}

function centreMark(card: Card, ink: string) {
  switch (card.kind) {
    case 'number':
      return <Numeral text={String(card.digit)} x={50} y={75} size={62} fill={ink} shadow={shadeOf(card)} />;
    case 'skip':
      return <SkipMark x={50} y={75} scale={1.35} color={ink} />;
    case 'reverse':
      return <ReverseMark x={50} y={75} scale={1.25} color={ink} />;
    case 'draw2':
      return <DrawTwoMark x={50} y={75} scale={1.25} color={ink} />;
    case 'wild':
      return null; // the quarters are the mark
    case 'wild4':
      return <DrawFourMark x={50} y={75} scale={1.2} />;
  }
}

function cornerMark(card: Card, x: number, y: number, flip: boolean) {
  const transform = flip ? `rotate(180 ${x} ${y})` : undefined;
  const scale = 0.42;
  switch (card.kind) {
    case 'number':
      return (
        <g transform={transform}>
          <Numeral text={String(card.digit)} x={x} y={y} size={26} fill="#ffffff" />
        </g>
      );
    case 'skip':
      return (
        <g transform={transform}>
          <SkipMark x={x} y={y} scale={scale} color="#ffffff" />
        </g>
      );
    case 'reverse':
      return (
        <g transform={transform}>
          <ReverseMark x={x} y={y} scale={scale} color="#ffffff" />
        </g>
      );
    case 'draw2':
      return (
        <g transform={transform}>
          <Numeral text="+2" x={x} y={y} size={22} fill="#ffffff" />
        </g>
      );
    case 'wild4':
      return (
        <g transform={transform}>
          <Numeral text="+4" x={x} y={y} size={22} fill="#ffffff" />
        </g>
      );
    case 'wild':
      return null;
  }
}

function fieldOf(card: Card): string {
  return card.color ? CARD_COLORS[card.color] : WILD_FIELD;
}

function shadeOf(card: Card): string {
  return card.color ? CARD_COLORS_DEEP[card.color] : WILD_FIELD_DEEP;
}

export function CardFace({ card, colorblind = false, className }: CardFaceProps) {
  const field = fieldOf(card);
  const ink = field;
  const isWild = card.kind === 'wild' || card.kind === 'wild4';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={cardLabel(card)}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{cardLabel(card)}</title>
      {/* White frame, then the colour field inside it. */}
      <rect x={0} y={0} width={W} height={H} rx={11} fill="#ffffff" />
      <rect x={5} y={5} width={W - 10} height={H - 10} rx={7.5} fill={field} />

      {/* The oval. On a Wild it holds the four colours instead of a value. */}
      {isWild && card.kind === 'wild' ? (
        <WildQuarters x={50} y={75} />
      ) : (
        <ellipse cx={50} cy={75} rx={41} ry={25} fill="#ffffff" transform="rotate(-20 50 75)" />
      )}

      {centreMark(card, isWild ? '#ffffff' : ink)}

      {cornerMark(card, 15, 22, false)}
      {cornerMark(card, W - 15, H - 22, true)}

      {/* Shape-per-colour, for anyone who cannot rely on hue. */}
      {colorblind && card.color && (
        <g transform={`translate(${W - 16} 22)`}>
          <ColorGlyph color={card.color} size={13} fill="#ffffff" />
        </g>
      )}
    </svg>
  );
}

/** The back of a card: what you see of everyone else's hand. */
export function CardBack({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="presentation" aria-hidden="true" focusable="false">
      <rect x={0} y={0} width={W} height={H} rx={11} fill="#ffffff" />
      <rect x={5} y={5} width={W - 10} height={H - 10} rx={7.5} fill="#12151b" />
      <ellipse cx={50} cy={75} rx={41} ry={25} fill="#e4322b" transform="rotate(-20 50 75)" />
      <g transform="rotate(-20 50 75)">
        <text
          x={50}
          y={75}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="'Helvetica Neue', 'Segoe UI', Inter, system-ui, sans-serif"
          fontWeight={900}
          fontSize={27}
          letterSpacing="-0.04em"
          fill="#ffffff"
          stroke="#ffffff"
          strokeWidth={1.4}
          paintOrder="stroke"
        >
          UNO
        </text>
      </g>
    </svg>
  );
}
