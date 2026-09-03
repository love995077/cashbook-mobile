import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-context';

/**
 * Contractor-only area.
 *
 * `dashboard` is itself a bottom-tab navigator (Workers / Attendance /
 * Settings); `worker/[id]` is one worker's detail view, pushed over the tabs;
 * and `new-entry` sits above both as a modal so logging an advance or an
 * attendance mark never loses the screen you were on.
 */
export default function ContractorLayout() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== 'contractor') return <Redirect href="/(worker)/dashboard" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="worker/[id]" />
      <Stack.Screen
        name="new-entry"
        options={{ presentation: 'modal', headerShown: false }}
      />
    </Stack>
  );
}
