import { Redirect, Stack } from 'expo-router';

import { homeRouteFor, useAuth } from '@/auth/auth-context';

/** Anyone already signed in has no business on the login screens. */
export default function AuthLayout() {
  const { user } = useAuth();

  if (user) return <Redirect href={homeRouteFor(user)} />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
