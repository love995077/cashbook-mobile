/**
 * Light / dark mode, chosen by the user and remembered across restarts.
 *
 * THREE STATES, NOT TWO
 * ---------------------
 * `system` is the default and is NOT the same as "light". A phone that flips
 * to dark at sunset should take the app with it, and a two-way toggle cannot
 * express that — once you tap it you are pinned to one side forever. So the
 * stored preference is `system | light | dark`, and only an explicit choice
 * overrides the OS.
 *
 * WHY THE PREFERENCE IS READ BEFORE THE FIRST PAINT
 * -------------------------------------------------
 * AsyncStorage is async, so there is a frame where the stored choice is not
 * known yet. Painting light and then snapping to dark is the flash every
 * theme implementation gets wrong. `isLoaded` is false until the read
 * finishes and the root layout holds the tree until then — the splash screen
 * is already up at that point, so it costs nothing visible.
 *
 * `useTheme()` keeps returning a plain palette object, so no screen that
 * already calls it needs to change.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { Colors, type Palette } from '@/constants/theme';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'cashbook.theme-mode';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

type ThemeValue = {
  /** What the user chose. `system` means "follow the phone". */
  mode: ThemeMode;
  /** What that actually resolves to right now. */
  scheme: ResolvedScheme;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
  /** False until the stored preference has been read. */
  isLoaded: boolean;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && isThemeMode(stored)) setModeState(stored);
      } catch {
        // A theme preference is not worth failing a launch over; the default
        // is `system`, which is the sane fallback anyway.
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // Applied immediately and persisted in the background: the toggle should
    // never feel like it is waiting on a disk write.
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // `system` can report null before the OS answers; light is the safer guess
  // than dark because the splash screen behind it is light.
  const scheme: ResolvedScheme =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeValue>(
    () => ({ mode, scheme, colors: Colors[scheme], setMode, isLoaded }),
    [mode, scheme, setMode, isLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The palette for the active theme.
 *
 * Falls back to the light palette when called outside the provider rather
 * than throwing: a component rendered above the tree (an error boundary, a
 * splash fallback) should still draw something readable.
 */
export function useTheme() {
  return useContext(ThemeContext)?.colors ?? Colors.light;
}

/** The preference itself — for the Dark Mode control in Settings. */
export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeMode must be used inside <ThemeProvider>');
  return value;
}
