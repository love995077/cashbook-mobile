import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-context';
import { canRunSites } from '@/data/types';

/**
 * Contractor-only area.
 *
 * `dashboard` is itself a bottom-tab navigator (Home / Workers / Sites /
 * Analytics / Settings, narrowed to three for a supervisor); `worker/[id]`,
 * `site/[id]`, `tools`, `piece-rate`, `deductions`, `deduction/[id]`,
 * `reports` and `invoices` are pushed over the tabs; and the entry forms sit
 * above both as modals, so logging an advance, an expense, an attendance mark
 * or a payroll settlement never loses the screen you were on.
 *
 * Every admin-only screen in here is guarded twice: the API refuses a
 * supervisor, and the app does not draw the way in. This gate is only the
 * outer one — see the tabs layout for what a supervisor actually sees.
 */
export default function ContractorLayout() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/(auth)/login" />;
  // Admins and supervisors both belong here. What a supervisor may SEE is
  // narrowed inside the area (see the tabs layout), not at this gate.
  if (!canRunSites(user.role)) return <Redirect href="/(worker)/dashboard" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="worker/[id]" />
      <Stack.Screen name="site/[id]" />
      <Stack.Screen name="tools" />
      <Stack.Screen name="approvals" />
      <Stack.Screen name="scan" />
      <Stack.Screen name="piece-rate" />
      <Stack.Screen name="deductions" />
      <Stack.Screen name="deduction/[id]" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="invoices" />
      <Stack.Screen name="ledger-check" />
      <Stack.Screen
        name="settle/[id]"
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="new-entry"
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="new-expense"
        options={{ presentation: 'modal', headerShown: false }}
      />
      <Stack.Screen
        name="categories"
        options={{ presentation: 'modal', headerShown: false }}
      />
    </Stack>
  );
}
