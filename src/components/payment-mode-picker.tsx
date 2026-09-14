import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { PaymentMode } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { PAYMENT_MODES } from '@/lib/money';

/**
 * How the money changed hands: Cash, UPI or Bank transfer.
 *
 * Three fixed options, so they are laid out as one row of radio cards rather
 * than a dropdown — the whole choice is visible and one tap wide, which is
 * what a contractor paying out on site needs. `Segmented` was the other
 * option; the icons do not fit its single line of text.
 */
export function PaymentModePicker({
  value,
  onChange,
  label = 'PAID BY',
  disabled = false,
}: {
  value: PaymentMode;
  onChange: (mode: PaymentMode) => void;
  label?: string | null;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}

      <View style={styles.row}>
        {PAYMENT_MODES.map((mode) => {
          const selected = mode.value === value;
          return (
            <Pressable
              key={mode.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`Paid by ${mode.label}`}
              disabled={disabled}
              onPress={() => onChange(mode.value)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: selected ? theme.tint : theme.border,
                  backgroundColor: selected ? `${theme.tint}1A` : theme.backgroundElement,
                  opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
                },
              ]}>
              <Ionicons
                name={mode.icon}
                size={18}
                color={selected ? theme.tint : theme.textSecondary}
              />
              <ThemedText
                type="small"
                numberOfLines={1}
                style={{ color: selected ? theme.tint : theme.textSecondary, fontWeight: '600' }}>
                {mode.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
});
