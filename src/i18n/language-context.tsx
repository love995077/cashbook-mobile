/**
 * English and Hindi for the strings a worker actually reads.
 *
 * SCOPE IS DELIBERATE
 * -------------------
 * This covers the worker-facing surface and the settings that reach it — the
 * screens used by someone who may not read English. The contractor's
 * accounting screens are not translated: they are dense with financial
 * terminology that a half-finished translation makes MORE confusing, not
 * less, and a wrong word in a ledger is worse than an English one.
 *
 * A flat dictionary rather than i18n-js or expo-localization: the string
 * count is small, the lookup is a property access, and it ships no extra
 * dependency. `t()` falls back to English on a missing key rather than
 * rendering the key itself — a worker seeing "worker.requestAdvance" is a bug
 * report nobody will file.
 *
 * Devanagari needs no font work: both iOS and Android ship it in the system
 * font, which is why the app's typography tokens are untouched here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Language = 'en' | 'hi';

const STORAGE_KEY = 'cashbook.language';

const EN = {
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.today': 'Today',
  'common.offline': 'You are offline.',

  'worker.greetingMorning': 'Good morning',
  'worker.greetingAfternoon': 'Good afternoon',
  'worker.greetingEvening': 'Good evening',
  'worker.myId': 'My ID',
  'worker.showAtGate': 'Show this at the gate to be marked present.',
  'worker.balance': 'Balance',
  'worker.requestAdvance': 'Request advance',
  'worker.requestAdvanceTitle': 'Ask for an advance',
  'worker.amount': 'Amount',
  'worker.reason': 'Reason (optional)',
  'worker.send': 'Send request',
  'worker.pending': 'Pending',
  'worker.approved': 'Approved',
  'worker.rejected': 'Rejected',
  'worker.myRequests': 'My requests',
  'worker.noRequests': 'No requests yet',
  'worker.mySite': 'My site',
  'worker.directions': 'Directions',
  'worker.noSite': 'You are not posted to a site yet.',
  'worker.attendance': 'Attendance',
  'worker.history': 'History',
  'worker.flag': 'Flag',
  'worker.disputed': 'Flagged',
  'worker.disputeTitle': 'Flag this day?',
  'worker.disputeBody':
    'Your contractor will be asked to check it. It does not change your balance by itself.',
  'worker.dayShift': 'Day',
  'worker.nightShift': 'Night',
  'worker.signOut': 'Sign out',
  'worker.settings': 'Settings',

  'settings.appearance': 'Appearance',
  'settings.darkMode': 'Dark mode',
  'settings.system': 'System',
  'settings.light': 'Light',
  'settings.dark': 'Dark',
  'settings.language': 'Language',
  'settings.english': 'English',
  'settings.hindi': 'हिंदी',
} as const;

export type StringKey = keyof typeof EN;

const HI: Partial<Record<StringKey, string>> = {
  'common.cancel': 'रद्द करें',
  'common.save': 'सहेजें',
  'common.close': 'बंद करें',
  'common.today': 'आज',
  'common.offline': 'आप ऑफ़लाइन हैं।',

  'worker.greetingMorning': 'सुप्रभात',
  'worker.greetingAfternoon': 'नमस्कार',
  'worker.greetingEvening': 'शुभ संध्या',
  'worker.myId': 'मेरी आईडी',
  'worker.showAtGate': 'हाज़िरी लगवाने के लिए गेट पर दिखाएँ।',
  'worker.balance': 'बकाया',
  'worker.requestAdvance': 'एडवांस माँगें',
  'worker.requestAdvanceTitle': 'एडवांस की माँग',
  'worker.amount': 'रकम',
  'worker.reason': 'कारण (वैकल्पिक)',
  'worker.send': 'भेजें',
  'worker.pending': 'विचाराधीन',
  'worker.approved': 'स्वीकृत',
  'worker.rejected': 'अस्वीकृत',
  'worker.myRequests': 'मेरी माँगें',
  'worker.noRequests': 'अभी कोई माँग नहीं',
  'worker.mySite': 'मेरी साइट',
  'worker.directions': 'रास्ता',
  'worker.noSite': 'आप अभी किसी साइट पर तैनात नहीं हैं।',
  'worker.attendance': 'हाज़िरी',
  'worker.history': 'इतिहास',
  'worker.flag': 'शिकायत',
  'worker.disputed': 'शिकायत दर्ज',
  'worker.disputeTitle': 'इस दिन पर शिकायत?',
  'worker.disputeBody':
    'आपके ठेकेदार से इसे जाँचने को कहा जाएगा। इससे आपका बकाया अपने आप नहीं बदलेगा।',
  'worker.dayShift': 'दिन',
  'worker.nightShift': 'रात',
  'worker.signOut': 'साइन आउट',
  'worker.settings': 'सेटिंग्स',

  'settings.appearance': 'रूप',
  'settings.darkMode': 'डार्क मोड',
  'settings.system': 'सिस्टम',
  'settings.light': 'हल्का',
  'settings.dark': 'गहरा',
  'settings.language': 'भाषा',
  'settings.english': 'English',
  'settings.hindi': 'हिंदी',
};

const DICTIONARIES: Record<Language, Partial<Record<StringKey, string>>> = {
  en: EN,
  hi: HI,
};

type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Translate a key, falling back to English when Hindi is missing it. */
  t: (key: StringKey) => string;
};

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && (stored === 'en' || stored === 'hi')) setLanguageState(stored);
      } catch {
        // English is the fallback; not worth failing a launch over.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const t = useCallback(
    (key: StringKey) => DICTIONARIES[language][key] ?? EN[key],
    [language]
  );

  const value = useMemo<LanguageValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return value;
}

/** Time-of-day greeting in the active language. */
export function useGreeting(): string {
  const { t } = useLanguage();
  const hour = new Date().getHours();
  if (hour < 12) return t('worker.greetingMorning');
  if (hour < 17) return t('worker.greetingAfternoon');
  return t('worker.greetingEvening');
}
