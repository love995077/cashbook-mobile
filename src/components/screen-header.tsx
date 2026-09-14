import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * In-screen header used instead of the navigator's, so the title, subtitle and
 * optional actions render identically on iOS and Android.
 *
 * `onBack` draws a chevron on the left. Screens reached with `router.push`
 * need it: Android has a hardware back gesture, iOS has nothing, and a pushed
 * route with no visible way out is a dead end.
 *
 * TWO KINDS OF ACTION, AND WHY
 * ----------------------------
 * `action` is the labelled pill — the one thing this screen is for ("Reports",
 * "+ Add Worker"). `icons` are the unlabelled round buttons beside it.
 *
 * They are separate props rather than one list because they compete for the
 * same corner: a settings gear floated over the header with absolute
 * positioning lands on top of the pill at narrow widths, which is exactly the
 * overlap this replaces. Laid out in one row, the pill shrinks and the icons
 * keep their hit area, so they cannot collide at any width.
 *
 * `greeting` swaps the plain title for the avatar-and-greeting block used on
 * the two dashboards.
 */
export type HeaderIcon = {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Spoken by screen readers — an unlabelled icon has nothing else to say. */
  accessibilityLabel: string;
  /** Draws a dot on the icon. For the approvals queue. */
  badge?: number;
};

export function ScreenHeader({
  title,
  subtitle,
  action,
  icons,
  onBack,
  greeting,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  icons?: HeaderIcon[];
  onBack?: () => void;
  /** Renders `title` as a greeting line above a large name, with an avatar. */
  greeting?: { name: string; salutation: string };
}) {
  const theme = useTheme();

  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
          <Ionicons name="chevron-back" size={24} color={theme.tint} />
        </Pressable>
      ) : null}

      {greeting ? (
        <View style={styles.greetingBlock}>
          <Avatar name={greeting.name} size={44} />
          <View style={styles.titleBlock}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {greeting.salutation}
            </ThemedText>
            {/* Tighter than `subtitle` type and heavier than `default`: the
                name is the anchor of the screen, but a 32pt subtitle would
                wrap for anyone called Rajendra Prasad Sharma. */}
            <ThemedText style={styles.greetingName} numberOfLines={1}>
              {greeting.name}
            </ThemedText>
          </View>
        </View>
      ) : (
        <View style={styles.titleBlock}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      )}

      <View style={styles.actions}>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.onTint }} numberOfLines={1}>
              {action.label}
            </ThemedText>
          </Pressable>
        ) : null}

        {icons?.map((icon) => (
          <Pressable
            key={icon.name}
            accessibilityRole="button"
            accessibilityLabel={icon.accessibilityLabel}
            onPress={icon.onPress}
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Ionicons name={icon.name} size={20} color={theme.text} />
            {icon.badge ? (
              <View style={[styles.badgeDot, { backgroundColor: theme.negative }]}>
                <ThemedText style={styles.badgeText}>
                  {icon.badge > 9 ? '9+' : icon.badge}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  titleBlock: {
    flex: 1,
    gap: 1,
  },
  greetingBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  greetingName: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Caps the pill so a long label cannot push the icons off the edge; the
    // label truncates instead.
    maxWidth: '55%',
  },
  action: {
    flexShrink: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
});
