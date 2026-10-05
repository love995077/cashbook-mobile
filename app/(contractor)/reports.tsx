import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReportsPanel } from '@/components/reports-panel';
import { ScreenHeader } from '@/components/screen-header';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useStore } from '@/data/store';
import { useTheme } from '@/hooks/use-theme';

/**
 * Downloadable reports - for the whole business, or (with `?siteId=`) one site.
 *
 * The site screen's Reports tab renders the same panel inline; this route is
 * the business-wide door, reached from Analytics and Settings.
 */
export default function ReportsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ siteId?: string }>();
  const { sites } = useStore();
  const siteId = params.siteId ? Number(params.siteId) : undefined;
  const site = siteId != null ? sites.find((candidate) => candidate.id === siteId) : undefined;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title={site ? `${site.name} reports` : 'Reports'}
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <ReportsPanel siteId={site?.id} siteName={site?.name} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
