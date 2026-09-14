/**
 * Confirmations and messages that survive the web build.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Alert` is exported by react-native-web, but its implementation is:
 *
 *     class Alert { static alert() {} }
 *
 * An empty method. On the web build every `Alert.alert(...)` is a silent
 * no-op — no dialog, and the `onPress` handlers passed to it are never
 * called. Any action gated behind a confirmation is therefore dead on web in
 * the worst possible way: the button reacts, nothing happens, no request is
 * sent, no loading state, no error. It reads as a failing API call and is not
 * one.
 *
 * So confirmations go through here instead of Alert directly. Native keeps
 * the real alert; web uses the browser's own dialogs, which are ugly but
 * blocking, honest, and always present.
 *
 * `confirm` resolves rather than taking callbacks, so a caller reads top to
 * bottom — `if (!(await confirm(...))) return;` — and the work stays in the
 * async function that owns the busy flag and the try/catch, instead of being
 * buried in a nested onPress.
 */

import { Alert, Platform } from 'react-native';

type ConfirmOptions = {
  title: string;
  message?: string;
  /** Label on the button that goes ahead. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in red on native. */
  destructive?: boolean;
};

/** True when the user went ahead, false when they backed out. */
export function confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    // window.confirm is present in every browser this runs in; the guard is
    // for the static-render pass, where there is no user to ask and no button
    // that could have been pressed.
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return Promise.resolve(false);
    }
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      // Android lets a tap outside dismiss the dialog without running any
      // button's onPress. Without this the promise never settles and the
      // caller waits forever — the same silent nothing this module exists to
      // get rid of.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

/** One option out of several, or null if they backed out. */
export type Choice<T> = {
  label: string;
  value: T;
  /** Red on native. The one that costs money or cannot be undone. */
  destructive?: boolean;
};

/**
 * Pick one of several actions — the action-sheet shape, which is a plain
 * `Alert` with more than two buttons on native.
 *
 * The web fallback is a numbered `window.prompt`. It is plain, and it is
 * deliberately not pretending to be more: the browser has no action sheet, and
 * a numbered list that works beats a styled one that does not exist. An
 * in-app sheet component would replace this branch and nothing else.
 */
export function choose<T>({
  title,
  message,
  options,
  cancelLabel = 'Cancel',
}: {
  title: string;
  message?: string;
  options: Choice<T>[];
  cancelLabel?: string;
}): Promise<T | null> {
  if (options.length === 0) return Promise.resolve(null);

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return Promise.resolve(null);

    // A single option is a yes/no question, not a menu.
    if (options.length === 1) {
      const only = options[0];
      return confirm({ title, message, confirmLabel: only.label, cancelLabel }).then(
        (ok) => (ok ? only.value : null)
      );
    }

    const menu = options.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
    const answer = window.prompt(
      [title, message, menu, `Enter 1-${options.length}, or cancel.`]
        .filter(Boolean)
        .join('\n\n'),
      '1'
    );
    if (answer === null) return Promise.resolve(null);

    const picked = Number.parseInt(answer.trim(), 10);
    if (!Number.isInteger(picked) || picked < 1 || picked > options.length) {
      return Promise.resolve(null);
    }
    return Promise.resolve(options[picked - 1].value);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        ...options.map((option) => ({
          text: option.label,
          style: option.destructive ? ('destructive' as const) : ('default' as const),
          onPress: () => resolve(option.value),
        })),
        { text: cancelLabel, style: 'cancel' as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

/** A message with nothing to decide — a result, or a failure. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
