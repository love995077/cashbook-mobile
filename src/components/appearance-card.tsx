import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Segmented } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useThemeMode } from '@/hooks/use-theme';
import { useLanguage, type Language } from '@/i18n/language-context';
import type { ThemeMode } from '@/theme/theme-context';

/**
 * Dark mode and language, shared by both settings screens.
 *
 * THREE THEME OPTIONS, NOT A SWITCH
 * ---------------------------------
 * A two-state toggle cannot say "follow the phone", so once a user touches it
 * they are pinned to one side forever — including through the sunset flip
 * they probably wanted. `System` is the default and stays reachable.
 *
 * Both settings persist to AsyncStorage and apply immediately; there is
 * nothing to save.
 */
export function AppearanceCard() {
  const { mode, setMode } = useThemeMode();
  const { language, setLanguage, t } = useLanguage();

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: t('settings.system') },
    { value: 'light', label: t('settings.light') },
    { value: 'dark', label: t('settings.dark') },
  ];

  const languageOptions: { value: Language; label: string }[] = [
    { value: 'en', label: t('settings.english') },
    { value: 'hi', label: t('settings.hindi') },
  ];

  return (
    <Card style={styles.card}>
      <View style={styles.group}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('settings.appearance')}
        </ThemedText>
        <Segmented options={themeOptions} value={mode} onChange={setMode} />
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('settings.language')}
        </ThemedText>
        <Segmented options={languageOptions} value={language} onChange={setLanguage} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.two,
  },
});
