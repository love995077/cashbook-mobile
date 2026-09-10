import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { WorkerTrade } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { postLabel, tradeInfo } from '@/lib/trades';

/**
 * A worker's post as an icon and a label — "⚡ Electrician".
 *
 * Renders nothing when no post is recorded, rather than a "not set"
 * placeholder: the crew list is scanned, and a row of grey placeholders is
 * noise between the badges that do carry meaning.
 *
 * A CUSTOM POST STILL GETS A BADGE
 * --------------------------------
 * Posts are free text, so most crews will carry some this build has no icon
 * for. Those draw in the theme's secondary text colour with the first letter
 * as the mark. Dropping them instead would be worse than the placeholder this
 * component otherwise avoids: the post *was* recorded, and a blank space says
 * it was not.
 *
 * `compact` drops the label and keeps the icon, for places where the name and
 * the amount already own the width — the bulk attendance grid, mainly.
 */
export function TradeBadge({
  trade,
  compact = false,
}: {
  trade: WorkerTrade | null | undefined;
  compact?: boolean;
}) {
  const theme = useTheme();
  const info = tradeInfo(trade);
  const label = postLabel(trade);

  // No post recorded at all — nothing to say.
  if (!label) return null;

  // A custom post has no catalogue entry. The initial stands in for the icon
  // so the badge keeps its shape and the row stays aligned with its neighbours.
  const icon = info ? info.icon : label.charAt(0).toUpperCase();
  const color = info ? info.color : theme.textSecondary;

  if (compact) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.dot, { backgroundColor: `${color}22` }]}>
        <ThemedText style={[styles.compactIcon, info ? null : { color }]}>{icon}</ThemedText>
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <ThemedText style={[styles.icon, info ? null : { color }]}>{icon}</ThemedText>
      <ThemedText type="small" style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    borderRadius: Radius.small,
    alignSelf: 'flex-start',
  },
  icon: {
    fontSize: 11,
    lineHeight: 16,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactIcon: {
    fontSize: 12,
    lineHeight: 16,
  },
});
