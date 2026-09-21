import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';

import { AppLockProvider, useAppLock } from '@/auth/app-lock';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { LockScreen } from '@/components/lock-screen';
import { AnimatedSplash } from '@/components/splash-screen';
import { StoreProvider } from '@/data/store';
import { LanguageProvider } from '@/i18n/language-context';
import { ThemeProvider, useThemeMode } from '@/theme/theme-context';

// Held until the stored session has been looked up, so the app never flashes
// the login screen at a user who is already signed in.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <Themed />
      </LanguageProvider>
    </ThemeProvider>
  );
}

/**
 * Sits inside ThemeProvider so it can read the resolved scheme.
 *
 * React Navigation keeps its own theme (it paints the bit behind the screens
 * during a transition), so it is fed the same resolved value rather than the
 * OS one - otherwise a user on light-mode-forced-dark would see a dark flash
 * between screens.
 */
function Themed() {
  const { scheme, isLoaded } = useThemeMode();

  // The stored preference has not been read yet. The splash screen is still
  // up, so holding here costs nothing visible and avoids painting the wrong
  // theme for one frame.
  if (!isLoaded) return null;

  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AppLockProvider>
          <StoreProvider>
            <RootNavigator />
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          </StoreProvider>
        </AppLockProvider>
      </AuthProvider>
    </NavThemeProvider>
  );
}

/**
 * The navigator lives in a child of AuthProvider so it can read the session.
 *
 * Routing by role is handled declaratively by each group's layout rather than
 * by an effect here: `app/index.tsx` sends you to the right place on launch,
 * and `(auth)`, `(worker)` and `(contractor)` each redirect anyone who does
 * not belong. That keeps the rules next to the routes they protect and avoids
 * navigating before the navigator has mounted.
 */
function RootNavigator() {
  const { isRestoring, user } = useAuth();
  const { locked } = useAppLock();
  /**
   * Whether the opening animation has finished (or been tapped away).
   *
   * Deliberately NOT gated on `isRestoring`. The two run side by side: the
   * session lookup is already in flight while the mark is drawing, so the
   * animation costs nothing it was not already waiting for. Chaining them
   * would add its full length to every cold start.
   */
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    if (!isRestoring) SplashScreen.hideAsync();
  }, [isRestoring]);

  // Expo's own splash is still up; mounting the navigator now would render a
  // route we may immediately redirect away from.
  if (isRestoring) return null;

  // The lock covers a signed-in session only. Someone at the login screen has
  // nothing to hide yet, and locking there would strand a user whose biometrics
  // stopped working with no way to reach the password field.
  const content =
    locked && user ? (
      <LockScreen />
    ) : (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(worker)" />
        <Stack.Screen name="(contractor)" />
      </Stack>
    );

  // The animation sits OVER the mounted app rather than instead of it, so the
  // dashboard behind it is laid out and painted before the black clears -
  // there is no second blank frame between the two.
  return (
    <>
      {content}
      {introDone ? null : <AnimatedSplash onDone={finishIntro} />}
    </>
  );
}
