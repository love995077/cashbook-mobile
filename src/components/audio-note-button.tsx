import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { uploadAudioNote } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/auth/auth-context';
import { Radius, Spacing } from '@/constants/theme';
import { notify } from '@/lib/dialog';
import { useTheme } from '@/hooks/use-theme';

/**
 * Hold-to-record a short voice note beside a text field.
 *
 * Uses expo-audio, NOT expo-av — expo-av was removed in SDK 54 and this
 * project is on 57. Shares the recorder setup with
 * `voice-entry-button.tsx`, but does something different with the result:
 * that one transcribes and writes entries, this one just stores the clip and
 * hands back a `path` for the surrounding form to submit.
 *
 * The upload happens on release rather than on submit, so by the time the
 * contractor taps Save the slow part is already done. `onChange` fires with
 * the path once stored, and with null when the note is discarded.
 *
 * Why this exists at all: a worker on a noisy site will say what an advance is
 * for; they will not type it on a cracked screen with wet hands.
 */

/** Below this it was a stray tap, not speech. */
const MIN_RECORDING_MS = 600;

type Phase = 'idle' | 'recording' | 'uploading' | 'stored';

export function AudioNoteButton({
  value,
  onChange,
  label = 'Hold to record a voice note',
}: {
  /** The stored path, or null. Owned by the parent form. */
  value: string | null;
  onChange: (path: string | null) => void;
  label?: string;
}) {
  const theme = useTheme();
  const { token } = useAuth();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<Phase>(value ? 'stored' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // iOS returns an empty clip if the app is not allowed to record while the
  // silent switch is on, which looks like a broken button rather than a
  // setting.
  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {
      // Not fatal — surfaced when recording actually fails.
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      notify(
        'Microphone needed',
        'Allow microphone access in Settings to attach a voice note.'
      );
      return;
    }

    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setPhase('recording');
    } catch (caught) {
      setError((caught as Error).message);
      setPhase('idle');
    }
  }, [recorder]);

  const stopAndUpload = useCallback(async () => {
    if (phase !== 'recording') return;

    const heldFor = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {
      // Already stopped.
    }

    const uri = recorder.uri;
    if (heldFor < MIN_RECORDING_MS || !uri) {
      setPhase('idle');
      setError('Hold the button while you speak.');
      return;
    }
    if (!token) {
      setPhase('idle');
      setError('You are not signed in.');
      return;
    }

    setPhase('uploading');
    try {
      const stored = await uploadAudioNote(token, {
        uri,
        name: 'note.m4a',
        // The HIGH_QUALITY preset writes AAC in an m4a container on both
        // platforms; the web build records webm.
        mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
      });
      if (!mounted.current) return;
      onChange(stored.path);
      setPhase('stored');
    } catch (caught) {
      if (!mounted.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not save the recording. Try again.'
      );
      setPhase('idle');
    }
  }, [phase, recorder, token, onChange]);

  function discard() {
    onChange(null);
    setPhase('idle');
    setError(null);
  }

  const recording = phase === 'recording';
  const busy = phase === 'uploading';

  if (phase === 'stored') {
    return (
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: `${theme.positive}22` }]}>
          <ThemedText type="small" style={{ color: theme.positive, fontWeight: '600' }}>
            Voice note attached
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove voice note"
          onPress={discard}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ThemedText type="small" style={{ color: theme.negative }}>
            Remove
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy }}
          disabled={busy}
          onPressIn={() => void start()}
          onPressOut={() => void stopAndUpload()}
          style={({ pressed }) => [
            styles.mic,
            {
              backgroundColor: recording ? theme.negative : theme.backgroundSelected,
              borderColor: recording ? theme.negative : theme.border,
              opacity: busy ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}>
          {busy ? (
            <ActivityIndicator color={theme.tint} />
          ) : (
            <ThemedText style={styles.micGlyph}>{recording ? '⏺' : '🎤'}</ThemedText>
          )}
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {recording ? 'Recording — release to save' : busy ? 'Saving…' : label}
        </ThemedText>
      </View>

      {error ? (
        <ThemedText type="small" style={{ color: theme.negative }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  mic: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  hint: {
    flexShrink: 1,
  },
  chip: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.small,
  },
});
