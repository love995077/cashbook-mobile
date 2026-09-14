import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CURRENCY, formatMoney } from '@/lib/money';

/**
 * A grouped bar chart drawn with plain Views.
 *
 * No charting library and no SVG: two rectangles per bucket with a height
 * proportional to the largest value on screen is the whole requirement, and
 * `react-native-svg` would be a native dependency to install, link and keep in
 * step with Expo for something a flexbox already does. The trade is that
 * anything curved - a line chart, an arc - would need the real thing.
 *
 * Bars are tappable: selecting one shows its exact figures above the chart,
 * which is how you read a value off a chart on a phone without a tooltip.
 */

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

const CHART_HEIGHT = 160;
const BAR_WIDTH = 14;
const GROUP_GAP = Spacing.three;

export function BarChart({
  labels,
  series,
  selectedIndex,
  onSelect,
  emptyMessage = 'Nothing recorded in this period.',
}: {
  labels: string[];
  series: ChartSeries[];
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  emptyMessage?: string;
}) {
  const theme = useTheme();
  const [internalIndex, setInternalIndex] = useState<number | null>(null);
  const selected = selectedIndex !== undefined ? selectedIndex : internalIndex;

  const max = useMemo(
    () => Math.max(0, ...series.flatMap((entry) => entry.values)),
    [series]
  );

  function select(index: number) {
    if (onSelect) onSelect(index);
    else setInternalIndex((current) => (current === index ? null : index));
  }

  if (labels.length === 0 || max === 0) {
    return (
      <View style={[styles.empty, { borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {emptyMessage}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        {series.map((entry) => (
          <View key={entry.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: entry.color }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {entry.label}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.plot}>
        <View style={styles.axis}>
          {[1, 0.5, 0].map((fraction) => (
            <ThemedText key={fraction} type="small" themeColor="textSecondary" style={styles.axisLabel}>
              {formatAxis(max * fraction)}
            </ThemedText>
          ))}
        </View>

        <View style={styles.plotBody}>
          {[0, 0.5, 1].map((fraction) => (
            <View
              key={fraction}
              style={[styles.gridline, { backgroundColor: theme.border, top: CHART_HEIGHT * fraction }]}
            />
          ))}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groups}>
            {labels.map((label, index) => {
              const isSelected = selected === index;
              return (
                <Pressable
                  key={`${label}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}: ${series
                    .map((entry) => `${entry.label} ${formatMoney(entry.values[index] ?? 0)}`)
                    .join(', ')}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => select(index)}
                  style={[
                    styles.group,
                    isSelected && { backgroundColor: `${theme.tint}14`, borderRadius: Radius.small },
                  ]}>
                  <View style={styles.bars}>
                    {series.map((entry) => {
                      const value = entry.values[index] ?? 0;
                      return (
                        <View
                          key={entry.key}
                          style={[
                            styles.bar,
                            {
                              backgroundColor: entry.color,
                              // A non-zero amount always gets a visible sliver,
                              // otherwise a small spend looks like no spend.
                              height: value > 0 ? Math.max(3, (value / max) * CHART_HEIGHT) : 1,
                              opacity: value > 0 ? 1 : 0.35,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                  <ThemedText
                    type="small"
                    themeColor={isSelected ? 'text' : 'textSecondary'}
                    numberOfLines={1}
                    style={styles.tick}>
                    {label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

/** Axis labels are about scale, not precision: 12500 reads as 12.5k. */
function formatAxis(value: number): string {
  if (value >= 100000) return `${CURRENCY}${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${CURRENCY}${Math.round(value / 1000)}k`;
  return `${CURRENCY}${Math.round(value)}`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  plot: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  axis: {
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    minWidth: 36,
  },
  axisLabel: {
    fontSize: 11,
    lineHeight: 12,
  },
  plotBody: {
    flex: 1,
  },
  gridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  groups: {
    gap: GROUP_GAP,
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.one,
  },
  group: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingTop: Spacing.one,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: CHART_HEIGHT,
  },
  bar: {
    width: BAR_WIDTH,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  tick: {
    fontSize: 11,
    lineHeight: 14,
  },
  empty: {
    height: CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
});
