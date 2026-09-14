/**
 * Press-and-hold microphone button.
 *
 * Uses expo-audio, NOT expo-av: expo-av was deprecated in SDK 52 and removed
 * in SDK 54, and is not part of SDK 57.
 *
 * Flow: hold -> record -> release -> upload to POST /api/voice-entry ->
 * show what the backend did -> refresh the dashboard.
 */

import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { uploadVoiceEntry, type VoiceEntryResult } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { notify } from '@/lib/dialog';
import { useTheme } from '@/hooks/use-theme';

/**
 * Below this, it was a stray tap rather than speech. Whisper invents fluent
 * text from near-silence, so short clips are dropped before they cost an API
 * call.
 */
const MIN_RECORDING_MS = 700;

type Phase = 'idle' | 'recording' | 'uploading';

export function VoiceEntryButton({ workerId }: { workerId?: number | null }) {
  const theme = useTheme();
  const { token } = useAuth();
  const { refresh } = useStore();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<VoiceEntryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Recording has to be enabled explicitly, and on iOS the app must be allowed
  // to record while the silent switch is on or the clip comes back empty.
  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {
      // Not fatal — surfaced when recording actually fails.
    });
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setResult(null);

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      notify(
        'Microphone needed',
        'Allow microphone access in Settings to record cashbook entries by voice.'
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
      const response = await uploadVoiceEntry(
        token,
        {
          uri,
          name: 'entry.m4a',
          // expo-audio's HIGH_QUALITY preset writes AAC in an m4a container on
          // both platforms; the web build records webm.
          mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
        },
        { workerId, language: 'hi' }
      );

      if (!mounted.current) return;
      setResult(response);

      // Only a write changes what the dashboard shows.
      if (response.status === 'recorded') await refresh();
    } catch (caught) {
      if (!mounted.current) return;
      const message =
        caught instanceof ApiError
          ? caught.message
          : 'Could not send the recording. Please try again.';
      setError(message);
    } finally {
      if (mounted.current) setPhase('idle');
    }
  }, [phase, recorder, token, workerId, refresh]);

  const busy = phase === 'uploading';
  const recording = phase === 'recording';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Press and hold to speak a cashbook entry"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPressIn={() => void startRecording()}
        onPressOut={() => void stopAndUpload()}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: recording ? theme.negative : theme.tint,
            opacity: busy ? 0.6 : pressed ? 0.9 : 1,
          },
        ]}>
        {busy ? (
          <ActivityIndicator color={theme.onTint} />
        ) : (
          <ThemedText style={[styles.label, { color: theme.onTint }]}>
            {recording ? '● Listening — release to save' : '🎤  Press and hold to speak'}
          </ThemedText>
        )}
      </Pressable>

      <Feedback result={result} error={error} busy={busy} recording={recording} />
    </View>
  );
}

function Feedback({
  result,
  error,
  busy,
  recording,
}: {
  result: VoiceEntryResult | null;
  error: string | null;
  busy: boolean;
  recording: boolean;
}) {
  const theme = useTheme();

  if (recording) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        e.g. “Aaj Suresh ko 600 rupaye wage aur 200 rupaye advance diya”
      </ThemedText>
    );
  }

  if (busy) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        Transcribing…
      </ThemedText>
    );
  }

  if (error) {
    return (
      <ThemedText type="small" style={[styles.hint, { color: theme.negative }]}>
        {error}
      </ThemedText>
    );
  }

  if (!result) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        Speak in Hindi — say the worker, the amount, and whether it is wage,
        advance or payment.
      </ThemedText>
    );
  }

  // Showing the transcript matters: it is the only way the contractor can tell
  // a misheard number from a mistyped one.
  const tone =
    result.status === 'recorded'
      ? theme.positive
      : result.status === 'needs_confirmation'
        ? theme.warning
        : theme.negative;

  return (
    <View style={styles.result}>
      {result.transcript ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          “{result.transcript}”
        </ThemedText>
      ) : null}
      <ThemedText type="smallBold" style={[styles.hint, { color: tone }]}>
        {result.message}
      </ThemedText>
      {result.problems.map((problem) => (
        <ThemedText key={problem} type="small" style={[styles.hint, { color: theme.warning }]}>
          • {problem}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  button: {
    minHeight: 56,
    borderRadius: Radius.large,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  label: {
    fontWeight: '600',
    fontSize: 16,
  },
  hint: {
    textAlign: 'center',
  },
  result: {
    gap: Spacing.one,
  },
});
