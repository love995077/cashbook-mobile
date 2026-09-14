import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { ErrorState, LoadingState } from '@/components/load-state';
import { ScreenHeader } from '@/components/screen-header';
import { SyncBanner } from '@/components/sync-banner';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Field } from '@/components/ui-kit';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-context';
import { useStore } from '@/data/store';
import { isAdmin } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/dialog';

/**
 * Sites tab: the jobs this contractor is running.
 *
 * A site is what photos, rain-outs and worker postings all hang off, so this
 * is the way into the per-site screen rather than a settings page nobody
 * would find.
 *
 * The add form is inline rather than a modal: a site is two fields, and a
 * contractor setting up for the first time is looking at an empty list with
 * nothing to press otherwise.
 *
 * A supervisor sees the same list, narrowed by the API to the sites they are
 * assigned, and no way to add one — creating a job is the contractor's act,
 * and `POST /contractor/sites` refuses them.
 */
export default function SitesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { sites, addSite, removeSite, loading, refreshing, error, refresh, isOnline } =
    useStore();

  const admin = isAdmin(user?.role);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  /**
   * Long-press a row to delete it.
   *
   * Long-press rather than a trash icon per row: the list is a set of places
   * you tap to open, and a delete target sitting beside every one of them is a
   * mis-tap waiting to happen on a phone held in a work glove. The site screen
   * carries the visible button for anyone who would rather see one.
   *
   * Tries the real delete and falls back to closing when the server answers
   * 409 — whether erasing is safe is its call, made against the counts it can
   * see. See the same flow on the site screen.
   */
  async function confirmDelete(siteId: number, siteName: string) {
    const ok = await confirm({
      title: `Delete ${siteName}?`,
      // The two outcomes differ in what happens to the crew, so the wording
      // has to as well: a purge unposts them (users.site_id is SET NULL), a
      // close deliberately leaves them posted, because who was on the job is
      // part of what the closed site still records. Saying "unposted" for
      // both promised something the close path does not do — and closing is
      // the path any site that has actually been used takes.
      message:
        'If nothing has been recorded against this site it is deleted outright and ' +
        'the workers posted here go back to unposted. If it has photos, petty cash, ' +
        'stock, plant or invoices on it, those are kept and the site is closed instead, ' +
        'with its crew still recorded against it — it leaves your list either way. ' +
        'Workers are never deleted.',
      confirmLabel: 'Delete site',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(siteId);
    setFormError(null);
    try {
      try {
        await removeSite(siteId, { purge: true });
        notify('Site deleted', `${siteName} had nothing on record and has been removed.`);
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.status !== 409) throw caught;
        await removeSite(siteId);
        notify(
          'Site closed',
          `${siteName} has history on it, so it has been closed rather than deleted. ` +
            'Its photos, cash and invoices are kept.'
        );
      }
    } catch (caught) {
      const message = (caught as Error).message;
      setFormError(message);
      notify('Could not delete the site', message);
    } finally {
      setDeleting(null);
    }
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Give the site a name');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await addSite({ name: trimmed, address: address.trim() || null });
      setName('');
      setAddress('');
      setAdding(false);
    } catch (caught) {
      // Stay open — a 409 on a duplicate name is the common one here.
      setFormError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const hasData = sites.length > 0;

  const body = () => {
    if (loading && !hasData) return <LoadingState label="Loading your sites…" />;
    if (error && !hasData) return <ErrorState message={error} onRetry={refresh} />;

    return (
      <FlatList
        data={sites}
        keyExtractor={(site) => String(site.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.tint} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.banner}>
              <SyncBanner />
            </View>

            {admin && adding ? (
              <Card style={styles.form}>
                <Field
                  label="Site name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Udaipur Villa"
                  autoCapitalize="words"
                  maxLength={120}
                  returnKeyType="next"
                />
                <Field
                  label="Address (optional)"
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Sector 4, Udaipur"
                  maxLength={255}
                  hint="Used for the directions button on the worker's dashboard."
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                />
                {formError ? (
                  <ThemedText type="small" style={{ color: theme.negative }}>
                    {formError}
                  </ThemedText>
                ) : null}
                <Button title="Add site" onPress={() => void submit()} loading={submitting} />
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setAdding(false);
                    setFormError(null);
                  }}
                  disabled={submitting}
                />
              </Card>
            ) : null}

            {error ? (
              <ThemedText type="small" style={[styles.inlineError, { color: theme.negative }]}>
                {error}
              </ThemedText>
            ) : null}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
              {sites.length} SITE{sites.length === 1 ? '' : 'S'}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.worker_count} workers`}
            accessibilityHint={admin ? 'Long press to delete this site' : undefined}
            onPress={() =>
              router.push({
                pathname: '/(contractor)/site/[id]',
                params: { id: String(item.id) },
              })
            }
            onLongPress={
              admin && isOnline ? () => void confirmDelete(item.id, item.name) : undefined
            }
            style={({ pressed }) => [
              styles.row,
              (pressed || deleting === item.id) && { opacity: 0.6 },
            ]}>
            <View style={[styles.marker, { backgroundColor: `${theme.tint}1F` }]}>
              <ThemedText style={styles.markerGlyph}>🏗</ThemedText>
            </View>

            <View style={styles.body}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {item.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {[
                  `${item.worker_count} worker${item.worker_count === 1 ? '' : 's'}`,
                  `${item.photo_count} photo${item.photo_count === 1 ? '' : 's'}`,
                  item.address,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </View>

            <ThemedText type="small" themeColor="textSecondary">
              ›
            </ThemedText>
          </Pressable>
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          adding ? null : (
            <EmptyState
              title={admin ? 'No sites yet' : 'No site assigned yet'}
              message={
                admin
                  ? 'Add the job you are running to start a photo log and mark rain-outs.'
                  : 'Your contractor assigns you to a site. Once they do, it shows up here.'
              }
              action={
                admin ? { label: '+ Add site', onPress: () => setAdding(true) } : undefined
              }
            />
          )
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScreenHeader
        title={admin ? 'Sites' : 'My site'}
        subtitle={isOnline ? undefined : 'Offline — showing the last known list'}
        action={
          admin && !adding ? { label: '+ Add site', onPress: () => setAdding(true) } : undefined
        }
      />
      {body()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  headerBlock: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  banner: {
    paddingHorizontal: Spacing.three,
  },
  form: {
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    letterSpacing: 0.5,
  },
  inlineError: {
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  marker: {
    width: 44,
    height: 44,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  body: {
    flex: 1,
    gap: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three + 44 + Spacing.three,
  },
});
