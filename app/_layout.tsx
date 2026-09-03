import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/auth-context';
import { StoreProvider } from '@/data/store';

// Held until the stored session has been looked up, so the app never flashes
// the login screen at a user who is already signed in.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <StoreProvider>
          <RootNavigator />
          <StatusBar style="auto" />
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
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
  const { isRestoring } = useAuth();

  useEffect(() => {
    if (!isRestoring) SplashScreen.hideAsync();
  }, [isRestoring]);

  // Splash is still up; mounting the navigator now would render a route we may
  // immediately redirect away from.
  if (isRestoring) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(worker)" />
      <Stack.Screen name="(contractor)" />
    </Stack>
  );
}
