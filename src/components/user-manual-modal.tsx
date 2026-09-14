import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * What this app does, read before signing in.
 *
 * Shown from the login screen, so it is the one screen in the app with no
 * session behind it: it must not read the store, call the API, or assume a
 * user. Everything here is static copy.
 *
 * A React Native `Modal` rather than a router route, matching
 * `AddWorkerModal`: the reader is on their way into the app and should land
 * back on the login form when they close it, not somewhere in a history stack.
 *
 * ACCURACY OVER SALESMANSHIP
 * --------------------------
 * The offline section says what genuinely survives a lost signal and names
 * what does not. Adding a worker needs a server-assigned id, and the
 * attendance grid is sent as one request that is not queued - both are
 * disabled offline in the app itself. A manual that promised "works
 * offline" flatly would be contradicted by the two features it goes on to
 * describe, and the person reading it is a contractor standing on a site with
 * one bar of signal deciding whether to trust it.
 */

type Section = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Kept short — these are scanned, not read. */
  points: string[];
};

const SECTIONS: Section[] = [
  {
    icon: 'cloud-offline-outline',
    title: 'Works with no signal',
    body:
      'Sites lose signal. Most of what you record is saved on the phone and sent by itself once you are back in range — you do not have to remember to do anything.',
    points: [
      'Marking one worker, cash in and out, and payments are all saved offline.',
      'A banner shows how many entries are waiting to be sent.',
      'Adding a worker and submitting a whole day at once need a connection. Those buttons tell you when they are unavailable.',
    ],
  },
  {
    icon: 'people-outline',
    title: 'Adding your crew',
    body:
      'A name is all you need. Everything else can be filled in later, so you can book someone onto the crew on the morning they turn up and sort out the details afterwards.',
    points: [
      'Mobile number and PIN are optional. Without them the worker goes on your crew and can be paid and marked, but cannot sign in themselves.',
      'Type any post — mason, shuttering carpenter, chowkidar. Tap a suggestion if it is one of the common ones.',
      'A day rate is optional too. Leave it blank if it changes from job to job.',
    ],
  },
  {
    icon: 'calendar-outline',
    title: 'Attendance, including past days',
    body:
      'The attendance screen opens on today, and the date picker at the top moves it back. So a Saturday nobody recorded can still be marked on Monday.',
    points: [
      'Use the arrows, the Today and Yesterday buttons, or tap the date to open a calendar.',
      'Everything follows the date you pick — who reads as already marked, the rain-out button, and the count in the header.',
      'Future days cannot be picked. Attendance is a record of what happened.',
      'Someone already marked for a day is shown locked, so sending the day twice cannot pay them twice.',
    ],
  },
  {
    icon: 'backspace-outline',
    title: 'Fixing a mistyped entry',
    body:
      'A wrong amount typed against a worker stays in your totals until it is taken out — taking the worker off your crew does not remove it, because money you really did hand over has to keep counting. So the entry itself is what you delete.',
    points: [
      'Open the worker, find the entry under HISTORY, and press and hold it.',
      'You are asked to confirm, and the question names the amount and the day so you can check it is the right one before it goes.',
      'The balance and the totals on your home screen update straight away.',
      'Delete only a mistake. If the money did change hands, leave it — the entry is your record of paying it.',
      'An advance you set up installments against will not delete until the installment plan is cancelled, so a plan can never be left collecting against nothing.',
    ],
  },
];

export function UserManualModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android hardware back and the iOS swipe both mean "close".
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the dimmed area closes, the standard way out of a modal. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.centre} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            <View style={styles.titleBar}>
              <View style={styles.titleText}>
                <ThemedText type="smallBold">How to use Cashbook</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  The three things worth knowing before you start.
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                hitSlop={12}
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}>
              {SECTIONS.map((section) => (
                <View key={section.title} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <View
                      style={[styles.iconDot, { backgroundColor: `${theme.tint}1A` }]}>
                      <Ionicons name={section.icon} size={18} color={theme.tint} />
                    </View>
                    <ThemedText type="smallBold" style={styles.sectionTitle}>
                      {section.title}
                    </ThemedText>
                  </View>

                  <ThemedText type="small" themeColor="textSecondary">
                    {section.body}
                  </ThemedText>

                  <View style={styles.points}>
                    {section.points.map((point) => (
                      <View key={point} style={styles.point}>
                        {/* A dot rather than a bullet character, so the text
                            wraps under itself instead of under the marker. */}
                        <View
                          style={[styles.bullet, { backgroundColor: theme.textSecondary }]}
                        />
                        <ThemedText type="small" themeColor="textSecondary" style={styles.pointText}>
                          {point}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              ))}

              <ThemedText type="small" themeColor="textSecondary" style={styles.tail}>
                Your contractor gives you the number and PIN you sign in with. If you do
                not have one yet, ask them to add you to the crew.
              </ThemedText>
            </ScrollView>

            {/* Outside the ScrollView so it stays reachable without scrolling
                to the end of the manual to get out of it. */}
            <View style={[styles.footer, { borderColor: theme.border }]}>
              <Button title="Close" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  centre: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth - 200,
    alignSelf: 'center',
    // The manual is longer than the screen on a small phone; it scrolls inside.
    maxHeight: '85%',
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  titleText: {
    flex: 1,
    gap: Spacing.one,
  },
  body: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flexShrink: 1,
  },
  points: {
    gap: Spacing.one,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  bullet: {
    width: 3,
    height: 3,
    borderRadius: 2,
    // Sits on the first line of text rather than the top of the block.
    marginTop: 8,
  },
  pointText: {
    flex: 1,
  },
  tail: {
    fontStyle: 'italic',
  },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
