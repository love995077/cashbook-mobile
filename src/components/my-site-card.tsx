import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/dialog';
import { useLanguage } from '@/i18n/language-context';
import type { SiteBrief } from '@/api/endpoints';

/**
 * Where the worker is posted, and how to get there.
 *
 * ADDRESS FIRST, NAME AS A FALLBACK
 * ---------------------------------
 * The maps query uses the site's address when there is one and the site name
 * when there is not. "Udaipur Villa" is a label the contractor invented and
 * Maps will happily send someone to a different state with it, so it is the
 * second choice, not the first — and the button is hidden entirely when
 * neither exists rather than opening a search for nothing.
 *
 * Platform-native URLs: `maps:` on iOS opens Apple Maps with the Google Maps
 * app still able to claim it, `geo:` on Android hits the installed maps app
 * directly. The https form is the fallback and the only thing that works on
 * web.
 */
export function MySiteCard({ site }: { site: SiteBrief | null }) {
  const theme = useTheme();
  const { t } = useLanguage();

  const query = site?.address?.trim() || site?.name?.trim() || null;

  async function openDirections() {
    if (!query) return;

    const encoded = encodeURIComponent(query);
    const web = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    const native = Platform.select({
      ios: `maps:0,0?q=${encoded}`,
      android: `geo:0,0?q=${encoded}`,
      default: web,
    });

    try {
      // Falls back rather than failing: a device with no maps app still has a
      // browser, and a worker standing on the road needs the directions more
      // than it needs the native app.
      const supported = await Linking.canOpenURL(native);
      await Linking.openURL(supported ? native : web);
    } catch {
      notify('Could not open maps', query);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="business-outline" size={20} color={theme.tint} />
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('worker.mySite')}
        </ThemedText>
      </View>

      {site ? (
        <>
          <ThemedText type="smallBold" numberOfLines={1}>
            {site.name}
          </ThemedText>
          {site.address ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {site.address}
            </ThemedText>
          ) : null}

          {query ? (
            <Button
              title={t('worker.directions')}
              variant="secondary"
              onPress={() => void openDirections()}
            />
          ) : null}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('worker.noSite')}
        </ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
