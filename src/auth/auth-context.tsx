/**
 * Session state, backed by the FastAPI auth routes.
 *
 * The token is kept in memory for request headers and mirrored into secure
 * storage, along with the profile it belongs to, so a relaunch can restore the
 * session without a second login — and, on a site with no signal, without the
 * server's help at all.
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
import {
  clearSession,
  isTokenExpired,
  loadProfile,
  loadToken,
  saveProfile,
  saveToken,
} from '@/auth/token-storage';
import { canRunSites } from '@/data/types';
import type { User, UserRole } from '@/data/types';

type SignUpInput = {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  /**
   * Which contractor this account belongs to. Required for a supervisor and
   * for a self-registering worker; a contractor belongs to nobody and leaves
   * it out.
   */
  contractor_id?: number | null;
};

type AuthValue = {
  user: User | null;
  token: string | null;
  /** True while the stored token is being checked — render a splash, not a redirect. */
  isRestoring: boolean;
  /**
   * True when the session on screen came from storage and the server has not
   * confirmed it this launch. The data is last-known, not live.
   */
  isOfflineSession: boolean;
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
  const [isOfflineSession, setIsOfflineSession] = useState(false);

  // Restore a stored session on launch.
  useEffect(() => {
    let active = true;

    (async () => {
      const [stored, cached] = await Promise.all([loadToken(), loadProfile()]);

      if (!stored) {
        if (active) setIsRestoring(false);
        return;
      }

      // Nothing can revive an expired token offline, and the server will
      // refuse it the moment signal returns. Better to ask for the password
      // now than to open a dashboard where every action fails.
      if (isTokenExpired(stored)) {
        await clearSession();
        if (active) setIsRestoring(false);
        return;
      }

      // Adopt the cached profile immediately. This is what gets a user with no
      // connection past the login screen; the server still overrides it below
      // whenever it can actually be reached.
      if (cached && active) {
        setToken(stored);
        setUser(cached);
        setIsOfflineSession(true);
      }

      try {
        const profile = await me(stored);
        if (!active) return;
        setToken(stored);
        setUser(profile);
        setIsOfflineSession(false);
        // Keep the cache in step with the server: a role or site change made
        // on another device must not persist in a stale offline profile.
        await saveProfile(profile);
      } catch (caught) {
        // Expired or revoked: drop it, including anything restored above. A
        // network failure keeps the cached session instead — a flaky
        // connection must not sign out a crew standing on a site.
        if (caught instanceof ApiError && !caught.isNetworkError) {
          await clearSession();
          if (active) {
            setToken(null);
            setUser(null);
            setIsOfflineSession(false);
          }
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
    await Promise.all([saveToken(session.token), saveProfile(session.user)]);
    setToken(session.token);
    setUser(session.user);
    setIsOfflineSession(false);
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
    await clearSession();
    setToken(null);
    setUser(null);
    setIsOfflineSession(false);
  }, []);

  const handleUnauthorized = useCallback(() => {
    void clearSession();
    setToken(null);
    setUser(null);
    setIsOfflineSession(false);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      token,
      isRestoring,
      isOfflineSession,
      signIn,
      signUp,
      signOut,
      handleUnauthorized,
    }),
    [user, token, isRestoring, isOfflineSession, signIn, signUp, signOut, handleUnauthorized]
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
  // Supervisors land in the contractor area too; its layout hides the
  // money from them rather than sending them somewhere else.
  return canRunSites(user.role) ? '/(contractor)/dashboard' : '/(worker)/dashboard';
}
