import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The floating action button on Home.
 *
 * Sits above the tab bar rather than inside the scroll view, so it stays put
 * while the ledger moves under it. `BottomTabInset` already accounts for the
 * platform tab bar height.
 */
export function Fab({
  onPress,
  icon = 'add',
  label = 'Add entry',
}: {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: theme.tint,
          bottom: BottomTabInset + Spacing.three,
          // A shadow on iOS, elevation on Android - both, so the button reads
          // as floating on either platform.
          shadowColor: '#000000',
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}>
      <Ionicons name={icon} size={28} color={theme.onTint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.three,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
