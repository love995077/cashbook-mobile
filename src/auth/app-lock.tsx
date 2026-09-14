/**
 * Optional Face ID / fingerprint lock over the whole signed-in app.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * This is a local gate on a device the contractor already controls. The
 * session token is what actually authenticates against the API, and it lives
 * in SecureStore either way - so the lock stops someone picking up an unlocked
 * phone and reading the ledger, and nothing more. It is deliberately not tied
 * to the token: making the token undecryptable without a biometric would lock
 * a contractor out of their own books the day a fingerprint sensor fails.
 *
 * WHEN IT ASKS
 * ------------
 * On launch, and whenever the app returns to the foreground after being away
 * for longer than GRACE_MS. A prompt on every task-switch would be unusable -
 * checking a photo of an invoice and coming back should not cost a scan.
 *
 * The preference lives in AsyncStorage rather than SecureStore: it is a
 * boolean about UI behaviour, not a secret, and reading it has to be fast
 * enough to happen before the first frame.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const PREFERENCE_KEY = 'cashbook.applock.enabled';

/** How long the app may sit in the background before it locks again. */
const GRACE_MS = 30_000;

export type BiometricSupport = {
  /** The device has the hardware. */
  hasHardware: boolean;
  /** The user has actually enrolled a face or a fingerprint. */
  isEnrolled: boolean;
  /** Best label for what this device offers: "Face ID", "Fingerprint". */
  label: string;
};

type AppLockValue = {
  /** Null until the stored preference has been read. */
  enabled: boolean | null;
  /** True when the app is showing the lock screen. */
  locked: boolean;
  support: BiometricSupport | null;
  /** Turning it on requires passing a scan first. Returns what happened. */
  setEnabled: (next: boolean) => Promise<{ ok: boolean; message?: string }>;
  /** Retry the prompt from the lock screen. */
  unlock: () => Promise<boolean>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

const NO_BIOMETRICS: BiometricSupport = {
  hasHardware: false,
  isEnrolled: false,
  label: 'Biometrics',
};

/**
 * Never throws. The module is unavailable on the web build and can fail on an
 * unusual Android device; either way the answer the caller needs is "no", not
 * an exception in the middle of rendering Settings.
 */
async function readSupport(): Promise<BiometricSupport> {
  let hasHardware = false;
  let isEnrolled = false;
  let types: LocalAuthentication.AuthenticationType[] = [];

  try {
    [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
  } catch {
    return NO_BIOMETRICS;
  }

  const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? 'Face ID'
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ? 'Fingerprint'
      : types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ? 'Iris'
        : 'Biometrics';

  return { hasHardware, isEnrolled, label };
}

async function prompt(reason: string): Promise<LocalAuthentication.LocalAuthenticationResult> {
  return LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    // The device passcode is the fallback: a wet thumb on a building site
    // must not be the thing standing between a contractor and their ledger.
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
  const [support, setSupport] = useState<BiometricSupport | null>(null);

  // When the app last went to the background, for the grace window.
  const backgroundedAt = useRef<number | null>(null);
  // Two prompts at once (launch + foreground) would stack native dialogs.
  const prompting = useRef(false);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (prompting.current) return false;
    prompting.current = true;
    try {
      const result = await prompt('Unlock Cashbook');
      if (result.success) {
        setLocked(false);
        backgroundedAt.current = null;
        return true;
      }
      return false;
    } catch {
      // A failed prompt leaves the app locked - the button on the lock screen
      // is the way to try again.
      return false;
    } finally {
      prompting.current = false;
    }
  }, []);

  /**
   * Lock, and ask straight away so the common case is one tap.
   *
   * The prompt is fired here, next to the two events that cause a lock, rather
   * than from an effect watching `locked` - a native dialog is an action, not
   * something to synchronise with render.
   */
  const lockAndPrompt = useCallback(() => {
    setLocked(true);
    void unlock();
  }, [unlock]);

  useEffect(() => {
    let active = true;

    (async () => {
      const [stored, capabilities] = await Promise.all([
        AsyncStorage.getItem(PREFERENCE_KEY).catch(() => null),
        readSupport(),
      ]);
      if (!active) return;

      const on = stored === 'true';
      setSupport(capabilities);
      // Enrolment can be removed after the preference was set. Treat that as
      // off rather than locking the contractor out of a device that can no
      // longer satisfy the prompt.
      const usable = on && capabilities.hasHardware && capabilities.isEnrolled;
      setEnabledState(usable);
      if (usable) lockAndPrompt();
    })();

    return () => {
      active = false;
    };
    // Only ever runs once; lockAndPrompt is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onChange = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        // Only the first transition counts: iOS reports 'inactive' before
        // 'background', and overwriting the stamp would reset the grace.
        backgroundedAt.current ??= Date.now();
        return;
      }

      if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since !== null && Date.now() - since > GRACE_MS) lockAndPrompt();
      }
    };

    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [enabled, lockAndPrompt]);

  const setEnabled = useCallback(
    async (next: boolean): Promise<{ ok: boolean; message?: string }> => {
      if (!next) {
        // Turning the lock off does not need a scan: the app is already
        // unlocked, which is the same proof.
        await AsyncStorage.setItem(PREFERENCE_KEY, 'false').catch(() => undefined);
        setEnabledState(false);
        setLocked(false);
        return { ok: true };
      }

      const capabilities = support ?? (await readSupport());
      setSupport(capabilities);

      if (!capabilities.hasHardware) {
        return { ok: false, message: 'This device does not support biometric unlock.' };
      }
      if (!capabilities.isEnrolled) {
        return {
          ok: false,
          message: `Set up ${capabilities.label} in your device settings first.`,
        };
      }

      // Prove the scan works before relying on it, otherwise the next launch
      // is the first time anyone finds out that it does not.
      let confirmed = false;
      try {
        confirmed = (await prompt('Confirm to turn on biometric unlock')).success;
      } catch {
        confirmed = false;
      }
      if (!confirmed) {
        return { ok: false, message: 'Could not confirm. Biometric unlock stays off.' };
      }

      await AsyncStorage.setItem(PREFERENCE_KEY, 'true').catch(() => undefined);
      setEnabledState(true);
      return { ok: true };
    },
    [support]
  );

  const value = useMemo<AppLockValue>(
    () => ({ enabled, locked, support, setEnabled, unlock }),
    [enabled, locked, support, setEnabled, unlock]
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock must be used inside <AppLockProvider>');
  return value;
}
