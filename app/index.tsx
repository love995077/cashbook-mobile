import { Redirect } from 'expo-router';

import { homeRouteFor, useAuth } from '@/auth/auth-context';

/**
 * Entry point: send the user wherever they belong.
 * Signed out -> login. Signed in -> their role's dashboard.
 */
export default function Index() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href={homeRouteFor(user)} />;
}
