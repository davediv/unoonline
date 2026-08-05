import type { Color } from '../../shared/types';

/**
 * The four. Deepened a touch from the classic values so they sit on a
 * near-black table without buzzing, and matched to the CSS theme.
 */
export const CARD_COLORS: Record<Color, string> = {
  red: '#e4322b',
  yellow: '#f5b222',
  green: '#2fa84f',
  blue: '#227fd6',
};

/** Used for the embossed shadow under a numeral. */
export const CARD_COLORS_DEEP: Record<Color, string> = {
  red: '#8f1a15',
  yellow: '#9d6a09',
  green: '#17632c',
  blue: '#104b83',
};
