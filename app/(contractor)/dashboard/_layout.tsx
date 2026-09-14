import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { isAdmin } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

/**
 * The bottom tabs, which are not the same set for everyone in this area.
 *
 * An ADMIN gets all five: Home, Workers, Sites, Analytics, Settings.
 *
 * A SUPERVISOR gets three — Home, Sites, Settings — and that is the whole of
 * the role's access control on this side of the wire. Workers and Analytics
 * are hidden rather than removed:
 *
 *   * Analytics IS the project finances. Cash in, cash out, the balance and
 *     the category breakdown are the numbers a supervisor must not see.
 *   * Workers is the way into `worker/[id]`, which shows a worker's ledger
 *     and carries the button through to `settle/[id]` — payroll settlement.
 *     Hiding the money means hiding the door to it, not just the screen
 *     behind it.
 *
 * `href: null` unregisters the tab from the bar while leaving the route
 * mounted, so a stale deep link does not crash into a missing screen. The API
 * refuses a supervisor on all of it anyway — this is the second lock, not the
 * only one. See `app/dependencies.py`.
 *
 * Attendance is hidden from the bar for both roles: it is a task you arrive
 * at from Home or from a worker, not a place you browse to.
 *
 * Headers are off — each screen draws its own so the title, subtitle and
 * action button line up the same way on iOS and Android.
 */
export default function ContractorTabsLayout() {
  const theme = useTheme();
  const { user } = useAuth();
  const admin = isAdmin(user?.role);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="workers"
        options={{
          title: 'Workers',
          href: admin ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sites"
        options={{
          title: admin ? 'Sites' : 'My site',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="business-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          href: admin ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen name="attendance" options={{ href: null }} />
    </Tabs>
  );
}
