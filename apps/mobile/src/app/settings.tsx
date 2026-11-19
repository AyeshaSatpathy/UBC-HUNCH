import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { studentError, useAccount, useCampus, useSession, useSettings } from '../api';
import { Button, ErrorNotice, Icon, Loading, Page, c, s } from '../ui';

export default function Settings() {
  const { api, loading, signedIn, setSession } = useSession();
  const account = useAccount();
  const details = useSettings();
  const campus = useCampus(account.data?.campusId);
  const target = useCampus(details.data?.pendingCampusId ?? undefined);
  const client = useQueryClient();
  const [section, setSection] = useState<'name' | 'campus' | 'about'>();
  const [name, setName] = useState('');
  const pendingCampusId = details.data?.pendingCampusId;
  useEffect(() => {
    if (pendingCampusId === null) void client.invalidateQueries({ queryKey: ['account'] });
  }, [pendingCampusId, client]);
  const saveName = useMutation({ mutationFn: () => api.auth.updateName.mutate({ displayName: name.trim() }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['account'] }); setSection(undefined); } });
  const notifications = useMutation({ mutationFn: (enabled: boolean) => api.auth.setNotifications.mutate({ enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['settings'] }) });
  const signOut = useMutation({ mutationFn: async () => {
    try { await api.auth.signOut.mutate(); } finally { await setSession(null); }
  } });
  if (loading) return <Page><Loading>Opening settings…</Loading></Page>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Page fill>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to profile" style={s.iconButton} onPress={() => router.dismissTo('/profile')}><Icon name="chevron-back" /></Pressable>
      <Text accessibilityRole="header" style={s.heading}>Settings</Text>
    </View>
    {details.isError && <ErrorNotice retry={() => void details.refetch()}>Could not load settings.</ErrorNotice>}
    <View style={s.field}>
      <Text style={s.label}>Notifications</Text>
      <View style={[s.row, s.between, { minHeight: 52 }]}>
        <Text style={s.body}>In-app notifications</Text>
        <Switch accessibilityLabel="In-app notifications" accessibilityHint="Show campus alerts in Feed"
          value={notifications.isPending ? notifications.variables : details.data?.notificationsEnabled ?? false}
          disabled={!details.data || notifications.isPending} onValueChange={value => notifications.mutate(value)}
          trackColor={{ false: c.border, true: c.lime }} thumbColor={c.cream} />
      </View>
      {notifications.isError && <ErrorNotice>Could not update notifications. Try again.</ErrorNotice>}
    </View>
    <View style={s.field}>
      <Text style={s.label}>Account</Text>
      <SettingRow label="Change name" detail={account.data?.displayName ?? undefined} onPress={() => { setName(account.data?.displayName ?? ''); setSection(section === 'name' ? undefined : 'name'); }} />
      {section === 'name' && <View style={s.field}>
        <TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} maxLength={40} style={s.input} autoComplete="given-name" />
        <Button label={saveName.isPending ? 'Saving…' : 'Save name'} disabled={!name.trim() || saveName.isPending} onPress={() => saveName.mutate()} />
        {saveName.isError && <ErrorNotice>Could not save your name. Try again.</ErrorNotice>}
      </View>}
      <SettingRow label="Change campus" detail={campus.data?.name} onPress={() => setSection(section === 'campus' ? undefined : 'campus')} />
      {!!details.data?.pendingCampusId && <Text style={s.muted}>{target.data ? 'Updating campus to ' + target.data.name + '…' : 'Campus update is processing…'}</Text>}
      {section === 'campus' && !details.data?.pendingCampusId && <CampusChange onVerified={() => setSection(undefined)} />}
    </View>
    <View>
      <SettingRow label="About Hunch" onPress={() => setSection(section === 'about' ? undefined : 'about')} />
      {section === 'about' && <Text style={[s.muted, { paddingVertical: 12 }]}>Hunch is a place to make predictions about life on campus. This build uses test funds. Cash withdrawals are unavailable.</Text>}
    </View>
    <Pressable accessibilityRole="button" disabled={signOut.isPending} onPress={() => signOut.mutate()}
      style={({ pressed }) => ({ minHeight: 48, marginTop: 'auto', justifyContent: 'center', alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Text style={[s.buttonText, { color: c.error }]}>{signOut.isPending ? 'Signing out…' : 'Sign out'}</Text>
    </Pressable>
  </Page>;
}

function SettingRow({ label, detail, onPress }: { label: string; detail?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} onPress={onPress}
    style={({ pressed }) => [s.row, s.between, { minHeight: 52, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.65 : 1 }]}>
    <View style={{ flex: 1, gap: 2 }}><Text style={s.body}>{label}</Text>{!!detail && <Text style={s.muted}>{detail}</Text>}</View>
    <Icon name="chevron-forward" color={c.muted} size={18} />
  </Pressable>;
}

function CampusChange({ onVerified }: { onVerified: () => void }) {
  const { api } = useSession();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState('');
  const send = useMutation({ mutationFn: () => api.auth.requestCampusChange.mutate({ email: email.trim() }),
    onSuccess: result => { setChallengeId(result.challengeId); setCode(''); } });
  const verify = useMutation({ mutationFn: (id: string) => api.auth.verifyCampusChange.mutate({ challengeId: id, code }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['settings'] }); onVerified(); } });
  const busy = send.isPending || verify.isPending;
  let fields: ReactNode;
  if (challengeId) {
    fields = <>
      <Text style={s.muted}>Enter the code sent to {email.trim()}.</Text>
      <TextInput accessibilityLabel="Campus verification code" value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))}
        keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} placeholder="Six-digit code" placeholderTextColor={c.muted} style={s.input} />
      <Button label={verify.isPending ? 'Verifying…' : 'Verify new campus'} disabled={busy || code.length !== 6} onPress={() => verify.mutate(challengeId)} />
      <Button label="Resend code" tone="quiet" disabled={busy} onPress={() => send.mutate()} />
    </>;
  } else {
    fields = <>
      <Text style={s.muted}>Verify your new school email. You’ll use it to log in after verification.</Text>
      <TextInput accessibilityLabel="New school email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        value={email} onChangeText={setEmail} placeholder="you@new-school.edu" placeholderTextColor={c.muted} style={s.input} />
      <Button label={send.isPending ? 'Sending…' : 'Send verification code'} disabled={busy || !/^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim())} onPress={() => send.mutate()} />
    </>;
  }
  return <View style={s.field}>{fields}
    {(send.isError || verify.isError) && <ErrorNotice>{studentError(verify.error ?? send.error, 'Could not verify your new campus. Check your details and try again.')}</ErrorNotice>}
  </View>;
}
