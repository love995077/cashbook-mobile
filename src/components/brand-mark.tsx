/**
 * The MoneyMate logo, as separately animatable layers.
 *
 * WHY THESE ARE PNGs AND NOT assets/cashbook logo.jpeg DIRECTLY
 * -------------------------------------------------------------
 * Two properties of the source file make it unusable on the splash as it
 * stands:
 *
 *  1. JPEG has no alpha channel. The logo's background is a solid #FEFEFE,
 *     so dropping it on the #000000 splash renders a white square with a logo
 *     in it. Keying all white out is not the answer either - the wallet's
 *     clasp and its ring are DRAWN in white, so that punches holes through
 *     the mark.
 *
 *  2. It is one flat raster. The splash animates the wallet, then springs the
 *     cash out of its top, then the wordmark, then the tagline - four things
 *     that are the same pixels in that file.
 *
 * So `scripts/extract_brand_layers.py` cuts the original into four layers. It
 * removes only the background-connected white by flood-filling from the
 * border, which leaves interior white (the clasp) as the paint it is, then
 * splits the result into connected components and groups them. The cash notes
 * turn out to be separate components from the mark, which is what makes the
 * spring in phase 2 possible at all.
 *
 * The `-on-black` variants are the same pixels with dark values lifted, hue
 * preserved: the brand's Deep Blue is 1.63:1 on black and would read as a
 * smudge. See `Brand` in constants/theme.ts.
 *
 * The original JPEG stays exactly where it is and remains the app icon, where
 * a white background is correct.
 */

import { Image, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

/**
 * The layers' coordinate system, used for aspect ratios and for placing the
 * cash relative to the mark.
 *
 * These are the sizes the layers were CUT at, not necessarily the pixel
 * dimensions of the files on disk - the wordmark and tagline were downscaled
 * afterwards to keep the bundle small, preserving aspect. Everything here is
 * ratios and offsets, so shrinking a file changes nothing as long as its
 * proportions hold.
 */
export const MARK_W = 540;
export const MARK_H = 400;
const CASH_W = 249;
const CASH_H = 127;
export const WORDMARK_W = 1035;
export const WORDMARK_H = 174;
export const TAGLINE_W = 724;
export const TAGLINE_H = 40;

/**
 * Where the cash sits relative to the mark's top-left, in source pixels.
 * Measured from the original rather than eyeballed, so the two layers
 * reassemble into exactly the logo that was drawn.
 */
const CASH_DX = 243;
const CASH_DY = -42;

const LAYERS = {
  light: {
    mark: require('../../assets/brand/mark.png'),
    cash: require('../../assets/brand/cash.png'),
    wordmark: require('../../assets/brand/wordmark.png'),
    tagline: require('../../assets/brand/tagline.png'),
  },
  black: {
    mark: require('../../assets/brand/mark-on-black.png'),
    cash: require('../../assets/brand/cash-on-black.png'),
    wordmark: require('../../assets/brand/wordmark-on-black.png'),
    tagline: require('../../assets/brand/tagline-on-black.png'),
  },
} as const;

export function brandLayers(onBlack: boolean) {
  return onBlack ? LAYERS.black : LAYERS.light;
}

/** Every layer module, for preloading before the splash animates. */
export const ALL_BRAND_LAYERS = [
  ...Object.values(LAYERS.light),
  ...Object.values(LAYERS.black),
];

export type BrandMarkProps = {
  /** Rendered width of the mark. Everything else scales from it. */
  size?: number;
  onBlack?: boolean;
  /** Animated opacity for the cash notes. Static when omitted. */
  cashOpacity?: SharedValue<number>;
  /** Animated Y offset for the cash notes, in rendered pixels. */
  cashLift?: SharedValue<number>;
};

/**
 * The wallet 'M' with its cash, assembled at `size` wide.
 *
 * With no animated values it is a plain static logo, which is what the header
 * and the login screen want. With them, the cash becomes independently
 * drivable and the wallet stays put.
 */
export function BrandMark({
  size = 160,
  onBlack = false,
  cashOpacity,
  cashLift,
}: BrandMarkProps) {
  const art = brandLayers(onBlack);
  const scale = size / MARK_W;
  const height = MARK_H * scale;

  const cash = (
    <Image
      source={art.cash}
      style={{ width: CASH_W * scale, height: CASH_H * scale }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );

  // The cash overlaps the top of the wallet in the original, so the container
  // is taller than the mark and the mark is pushed down by the overhang.
  const overhang = Math.abs(CASH_DY) * scale;

  return (
    <View style={{ width: size, height: height + overhang }}>
      <Image
        source={art.mark}
        style={{
          position: 'absolute',
          top: overhang,
          left: 0,
          width: size,
          height,
        }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />

      {cashOpacity || cashLift ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: CASH_DX * scale,
              top: overhang + CASH_DY * scale,
            },
            cashOpacity ? { opacity: cashOpacity } : null,
            cashLift ? { transform: [{ translateY: cashLift }] } : null,
          ]}
          pointerEvents="none">
          {cash}
        </Animated.View>
      ) : (
        <View
          style={{
            position: 'absolute',
            left: CASH_DX * scale,
            top: overhang + CASH_DY * scale,
          }}
          pointerEvents="none">
          {cash}
        </View>
      )}
    </View>
  );
}

/** The 'MoneyMate' wordmark on its own, at `width` wide. */
export function BrandWordmark({
  width = 220,
  onBlack = false,
}: {
  width?: number;
  onBlack?: boolean;
}) {
  return (
    <Image
      source={brandLayers(onBlack).wordmark}
      style={{ width, height: (WORDMARK_H / WORDMARK_W) * width }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/** 'Track - Save - Grow', at `width` wide. */
export function BrandTagline({
  width = 180,
  onBlack = false,
}: {
  width?: number;
  onBlack?: boolean;
}) {
  return (
    <Image
      source={brandLayers(onBlack).tagline}
      style={{ width, height: (TAGLINE_H / TAGLINE_W) * width }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
