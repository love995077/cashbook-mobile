/**
 * Session state, backed by the FastAPI auth routes.
 *
 * The token is kept in memory for request headers and mirrored into secure
 * storage so a relaunch can restore the session without a second login.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiError } from '@/api/client';
import { login as loginRequest, me, register as registerRequest } from '@/api/endpoints';
import { clearToken, loadToken, saveToken } from '@/auth/token-storage';
import type { User, UserRole } from '@/data/types';

type SignUpInput = {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
};

type AuthValue = {
  user: User | null;
  token: string | null;
  /** True while the stored token is being checked — render a splash, not a redirect. */
  isRestoring: boolean;
  signIn: (phone: string, password: string) => Promise<User>;
  signUp: (input: SignUpInput) => Promise<User>;
  signOut: () => Promise<void>;
  /** Drop the session because the API rejected the token (401). */
  handleUnauthorized: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore a stored session on launch: the token is only trusted once
  // GET /auth/me confirms the server still accepts it.
  useEffect(() => {
    let active = true;

    (async () => {
      const stored = await loadToken();
      if (!stored) {
        if (active) setIsRestoring(false);
        return;
      }

      try {
        const profile = await me(stored);
        if (!active) return;
        setToken(stored);
        setUser(profile);
      } catch (caught) {
        // Expired or revoked: drop it. A network failure keeps the token so a
        // flaky connection does not silently log the user out.
        if (caught instanceof ApiError && !caught.isNetworkError) {
          await clearToken();
        }
      } finally {
        if (active) setIsRestoring(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const adoptSession = useCallback(async (session: { token: string; user: User }) => {
    await saveToken(session.token);
    setToken(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const signIn = useCallback(
    async (phone: string, password: string) => adoptSession(await loginRequest(phone, password)),
    [adoptSession]
  );

  const signUp = useCallback(
    async (input: SignUpInput) => adoptSession(await registerRequest(input)),
    [adoptSession]
  );

  const signOut = useCallback(async () => {
    await clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    void clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, token, isRestoring, signIn, signUp, signOut, handleUnauthorized }),
    [user, token, isRestoring, signIn, signUp, signOut, handleUnauthorized]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Where a signed-in user belongs, by role. */
export function homeRouteFor(user: User): '/(contractor)/dashboard' | '/(worker)/dashboard' {
  return user.role === 'contractor' ? '/(contractor)/dashboard' : '/(worker)/dashboard';
}
