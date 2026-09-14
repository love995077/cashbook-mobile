/**
 * The palette for the active theme.
 *
 * Re-exported from the theme context rather than reading the OS directly, so
 * the Dark Mode control in Settings reaches every screen that already calls
 * `useTheme()` without any of them changing.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

export { useTheme, useThemeMode } from '@/theme/theme-context';
export type { ResolvedScheme, ThemeMode } from '@/theme/theme-context';
