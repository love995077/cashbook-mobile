import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { API_BASE_URL } from '@/api/client';
import { useTheme } from '@/hooks/use-theme';

/**
 * Play a voice note attached to a ledger row or an advance request.
 *
 * Deliberately tiny — one tap to play, one to stop. Recording a note is
 * pointless if nobody on the other end can hear it, and a disputed entry is
 * exactly the moment somebody wants to.
 */
export function AudioNotePlayer({ url, compact = false }: { url: string; compact?: boolean }) {
  const theme = useTheme();
  // The API returns app-relative media paths ("/media/audio/…") so the link
  // survives a change of hostname; the player needs an absolute one.
  const source = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;

  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const playing = status?.playing ?? false;

  function toggle() {
    if (playing) {
      player.pause();
      // Rewind, so the next tap replays from the start rather than resuming
      // two seconds from the end.
      player.seekTo(0);
      return;
    }
    player.seekTo(0);
    player.play();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Stop voice note' : 'Play voice note'}
      accessibilityState={{ selected: playing }}
      onPress={toggle}
      hitSlop={8}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.compact,
        {
          backgroundColor: playing ? `${theme.tint}22` : theme.backgroundSelected,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText style={styles.glyph}>{playing ? '⏸' : '▶'}</ThemedText>
      {compact ? null : (
        <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>
          Voice note
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radius.small,
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: Spacing.one + 2,
  },
  glyph: {
    fontSize: 12,
    lineHeight: 16,
  },
});
