/**
 * Colors, fonts and spacing for the app, in light and dark mode.
 *
 * There are many other ways to style a React Native app — for example
 * [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/),
 * [unistyles](https://reactnativeunistyles.vercel.app) — this app sticks to
 * plain StyleSheet plus these tokens.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * The MoneyMate mark, sampled straight from assets/cashbook logo.jpeg.
 *
 * These are the brand's own values and do not change between light and dark -
 * they are what the logo IS. The semantic palettes below choose which of them
 * to use where, and substitute when one of them cannot be read.
 */
export const Brand = {
  /** 'Money' in the wordmark. The primary. */
  deepBlue: '#012D74',
  /** 'Mate' in the wordmark, and the wallet. The accent. */
  green: '#019758',
  /** The left stroke of the M. */
  mStroke: '#014D8B',
  /** The wallet body, right of the M. */
  wallet: '#01996A',
  /** The notes flicking out of the wallet's top. */
  cash: '#2AB272',

  /**
   * Substitutes for the splash, which is solid black.
   *
   * `deepBlue` on #000000 is 1.63:1 - below even the 3:1 floor for large
   * graphics, so the M would read as a dark smudge. `blueOnBlack` is the same
   * hue lifted to 4.92:1. The tagline's own #323C46 is 1.87:1 on black and
   * becomes `mist` at 13.61:1.
   */
  blueOnBlack: '#2E7BD6',
  greenOnBlack: '#34D98B',
  mist: '#C9D1D9',
  black: '#000000',

  /**
   * The green with enough weight to carry white text.
   *
   * White on `green` is 3.77:1, which fails the 4.5:1 a button label needs.
   * This is the same hue darkened to 5.14:1 and is what every filled control
   * uses; `green` itself stays for marks and fills that carry no text.
   */
  greenInk: '#017E49',
} as const;

export const Colors = {
  light: {
    // Deep Blue carries the text, as the brand asks. 11.9:1 on the app
    // background and 12.9:1 on a card - darker than it looks, because the
    // hue is saturated rather than light.
    text: Brand.deepBlue,
    background: '#F4F6FA',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E3EAF5',
    textSecondary: '#5A6B8C',
    border: '#D4DBE8',
    // Vibrant Green is the accent: buttons, active tabs, the FAB. `greenInk`
    // rather than `green` because `onTint` sits on top of it.
    tint: Brand.greenInk,
    onTint: '#FFFFFF',
    // Money moving toward the worker vs. away from them.
    positive: Brand.greenInk,
    negative: '#D93036',
    warning: '#B25E09',
  },
  dark: {
    text: '#FFFFFF',
    // Matches the splash, so the app does not flash a different black on
    // first paint.
    background: Brand.black,
    backgroundElement: '#101418',
    backgroundSelected: '#1B2430',
    textSecondary: '#9AA7BD',
    border: '#232C38',
    // The light theme's `greenInk` is too dark to read on black (2.2:1), so
    // dark mode takes the lifted green instead - same accent, 11.4:1.
    tint: Brand.greenOnBlack,
    onTint: '#00210F',
    positive: Brand.greenOnBlack,
    negative: '#FF6369',
    warning: '#F0A252',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * One theme's colours, widened to `string`.
 *
 * `Colors` is `as const` so each hex is a literal type, which makes
 * `Colors.light` and `Colors.dark` mutually unassignable - fine while the
 * scheme was picked at the module boundary, a type error the moment a theme
 * is chosen at runtime. This is the type everything downstream should use.
 */
export type Palette = Record<ThemeColor, string>;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  large: 20,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
