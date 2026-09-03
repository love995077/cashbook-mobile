import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-context';

/** Worker-only area: contractors get bounced to their own dashboard. */
export default function WorkerLayout() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.role !== 'worker') return <Redirect href="/(contractor)/dashboard" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
    </Stack>
  );
}
