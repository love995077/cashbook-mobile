/**
 * The MoneyMate opening animation.
 *
 * Solid #FFFFFF behind four phases, in order:
 *
 *   1. the wallet 'M' fades and scales in
 *   2. the cash springs out of the wallet's top
 *   3. the 'MoneyMate' wordmark fades in below
 *   4. the 'Track - Save - Grow' tagline fades in under that
 *
 * WHY WHITE, AND WHY THAT SIMPLIFIES THE COLOUR
 * ---------------------------------------------
 * The layers are cut from a JPEG that was drawn on white. However carefully
 * the background is keyed out, the outermost ring of each glyph is still
 * blended with the white it was drawn against - on a dark screen that shows
 * as a pale fringe. On white it is invisible, because it IS the background.
 *
 * It also lets the logo keep its own colours. The brand's Deep Blue is
 * #012D74, which is 1.63:1 on black (a smudge) but 12.9:1 on white, so the
 * splash now uses the `light` layer set - the untouched artwork - rather than
 * the lifted `-on-black` variants. Nothing is recoloured to be legible.
 *
 * There is deliberately NO glow. It existed only to rescue the deep blue from
 * a black background; over white the same bloom is a grey smear behind the
 * mark, solving a problem that no longer exists.
 *
 * WHY IT CANNOT BE SKIPPED BY TAPPING
 * -----------------------------------
 * It can - see `onDone` and the Pressable. A splash that holds a user hostage
 * for two seconds on every cold start is a splash they learn to resent, and
 * the animation is decoration over work that is already happening (the token
 * read and the first fetch), not a loading bar for it.
 *
 * ACCESSIBILITY
 * -------------
 * `useReducedMotion` collapses all four phases to a single fade. The sequence
 * is a flourish, and a flourish is exactly what someone who has asked for
 * less motion has asked not to see.
 */

import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Asset } from 'expo-asset';

import {
  ALL_BRAND_LAYERS,
  BrandMark,
  BrandTagline,
  BrandWordmark,
} from '@/components/brand-mark';

/** Phase boundaries, ms from the start. Named so the sequence reads in order. */
const MARK_IN = 520;
const CASH_AT = 430;
const WORD_AT = 900;
const TAG_AT = 1250;

/**
 * Longest the splash will wait for its own artwork before animating anyway.
 *
 * A decode that never finishes must not become a blank screen the user cannot
 * leave, so the wait is bounded and the sequence starts regardless.
 */
const ASSET_TIMEOUT = 1200;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();

  /**
   * Whether the four PNG layers have decoded.
   *
   * WHY THE ANIMATION WAITS FOR THIS
   * --------------------------------
   * Without it the sequence starts on mount while the images are still
   * decoding, so the opening second is an empty screen. The animation was
   * running correctly; there was simply nothing to draw yet.
   *
   * Caught in the browser, where it is most visible: a cold load played most
   * of phase 1 before the mark appeared at all.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const done = () => {
      if (live) setReady(true);
    };
    // Bounded: see ASSET_TIMEOUT.
    const bail = setTimeout(done, ASSET_TIMEOUT);
    Asset.loadAsync(ALL_BRAND_LAYERS)
      .then(done)
      .catch(done);
    return () => {
      live = false;
      clearTimeout(bail);
    };
  }, []);

  const markOpacity = useSharedValue(0);
  const markScale = useSharedValue(0.82);
  const cashOpacity = useSharedValue(0);
  const cashLift = useSharedValue(34);
  const wordOpacity = useSharedValue(0);
  const wordLift = useSharedValue(14);
  const tagOpacity = useSharedValue(0);

  useEffect(() => {
    if (!ready) return;

    if (reduceMotion) {
      markOpacity.value = 1;
      markScale.value = 1;
      cashOpacity.value = 1;
      cashLift.value = 0;
      wordOpacity.value = 1;
      wordLift.value = 0;
      // One fade, then out. `runOnJS` because `onDone` sets React state and
      // the callback fires on the UI thread.
      tagOpacity.value = withTiming(1, { duration: 320 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
      return;
    }

    // --- phase 1: the mark draws in -------------------------------------
    markOpacity.value = withTiming(1, {
      duration: MARK_IN,
      easing: Easing.out(Easing.cubic),
    });
    markScale.value = withSpring(1, { damping: 13, stiffness: 110 });

    // --- phase 2: the cash springs out ----------------------------------
    cashOpacity.value = withDelay(CASH_AT, withTiming(1, { duration: 240 }));
    cashLift.value = withDelay(
      CASH_AT,
      // Low damping so it overshoots and settles - notes flicking out, not
      // sliding out.
      withSpring(0, { damping: 9, stiffness: 140, mass: 0.7 })
    );

    // --- phase 3: the wordmark ------------------------------------------
    wordOpacity.value = withDelay(WORD_AT, withTiming(1, { duration: 380 }));
    wordLift.value = withDelay(
      WORD_AT,
      withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) })
    );

    // --- phase 4: the tagline, then hand over ---------------------------
    tagOpacity.value = withDelay(
      TAG_AT,
      withTiming(1, { duration: 360 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
  }, [
    ready,
    reduceMotion,
    onDone,
    markOpacity,
    markScale,
    cashOpacity,
    cashLift,
    wordOpacity,
    wordLift,
    tagOpacity,
  ]);

  // Tearing down mid-flight would otherwise leave the timing callback holding
  // a reference to a component that has gone.
  useEffect(
    () => () => {
      cancelAnimation(markOpacity);
      cancelAnimation(markScale);
      cancelAnimation(cashOpacity);
      cancelAnimation(cashLift);
      cancelAnimation(wordOpacity);
      cancelAnimation(wordLift);
      cancelAnimation(tagOpacity);
    },
    [
      markOpacity,
      markScale,
      cashOpacity,
      cashLift,
      wordOpacity,
      wordLift,
      tagOpacity,
    ]
  );

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));

  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordLift.value }],
  }));

  const tagStyle = useAnimatedStyle(() => ({ opacity: tagOpacity.value }));

  return (
    <Pressable
      style={styles.root}
      accessibilityRole="button"
      accessibilityLabel="MoneyMate. Track, save, grow."
      accessibilityHint="Skips the opening animation"
      onPress={onDone}>
      {/* Dark icons against the white; the app's own StatusBar takes over
          again the moment this unmounts. */}
      <StatusBar style="dark" />

      <View style={styles.centre}>
        <View style={styles.markWrap}>
          <Animated.View style={markStyle}>
            <BrandMark size={180} cashOpacity={cashOpacity} cashLift={cashLift} />
          </Animated.View>
        </View>

        {/* The real wordmark, cut from the logo, rather than two coloured
            Texts approximating it. The original is a custom face - setting it
            in the system font would be a near-miss, which reads worse than an
            obvious substitute. */}
        <Animated.View style={[styles.wordmark, wordStyle]}>
          <BrandWordmark width={236} />
        </Animated.View>

        <Animated.View style={[styles.tagline, tagStyle]}>
          <BrandTagline width={186} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    // Explicitly white, not a theme token: this screen is the same white in
    // light mode and dark mode, because the artwork was drawn on white and
    // only reads cleanly against it.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { alignItems: 'center', justifyContent: 'center' },
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  wordmark: { marginTop: 26 },
  tagline: { marginTop: 14 },
});
