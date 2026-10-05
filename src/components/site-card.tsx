import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { Site, SiteOverview } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * One job on the site-selection Home screen.
 *
 * It answers the three things a contractor opens the app to ask about a site
 * before deciding which one to go into: is today's crew marked, what is still
 * owed to the people working there, and what has the site cost this month.
 * Everything deeper - the crew, the expenses, the reports - is one tap in.
 *
 * `overview` is optional: a card painted from cache before the network
 * answers, or for a site created a moment ago, still shows the name and the
 * crew count the site row carries.
 */
export function SiteCard({
  site,
  overview,
  onPress,
}: {
  site: Site;
  overview?: SiteOverview;
  onPress: () => void;
}) {
  const theme = useTheme();
  const crew = overview?.crew_active ?? site.worker_count;
  const marked = overview?.marked_today ?? 0;
  const progress = crew > 0 ? Math.min(marked / crew, 1) : 0;
  const allMarked = crew > 0 && marked >= crew;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        site.name,
        `${crew} on the crew`,
        overview ? `${marked} marked today` : null,
        overview ? `${CURRENCY}${formatMoney(overview.outstanding_payable)} owed` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens this site's labour, expenses and reports"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: site.is_active ? (pressed ? 0.75 : 1) : 0.6,
        },
      ]}>
      <View style={styles.head}>
        <View style={[styles.marker, { backgroundColor: `${theme.tint}1F` }]}>
          <Ionicons name="business-outline" size={20} color={theme.tint} />
        </View>
        <View style={styles.title}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {site.name}
            {site.is_active ? '' : ' · closed'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {[site.address, site.supervisor_name ? `Run by ${site.supervisor_name}` : null]
              .filter(Boolean)
              .join(' · ') || 'No address yet'}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </View>

      <View style={styles.stats}>
        <Stat label="Crew" value={String(crew)} />
        <Stat
          label="Owed"
          value={overview ? `${CURRENCY}${formatMoney(overview.outstanding_payable)}` : '—'}
          color={overview && overview.outstanding_payable > 0 ? theme.warning : undefined}
        />
        <Stat
          label="This month"
          value={overview ? `${CURRENCY}${formatMoney(overview.month_spend)}` : '—'}
        />
      </View>

      {crew > 0 ? (
        <View style={styles.today}>
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: allMarked ? theme.positive : theme.tint,
                },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {allMarked ? 'Everyone marked today' : `${marked} of ${crew} marked today`}
          </ThemedText>
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody posted here yet.
        </ThemedText>
      )}
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={1} style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  marker: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    gap: 1,
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stat: {
    flex: 1,
    gap: 1,
  },
  today: {
    gap: Spacing.one,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
});
