import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { studentError, useAccount, useCampus, useSession } from '../api';
import { Button, ErrorNotice, Icon, Loading, Page, c, s } from '../ui';

export default function Settings() {
  const { api, loading, signedIn, setSession } = useSession();
  const account = useAccount();
  const campus = useCampus(account.data?.campusId);
  const client = useQueryClient();
  const details = useQuery({ queryKey: ['settings'], enabled: signedIn,
    queryFn: ({ signal }) => api.auth.settings.query(undefined, { signal }), retry: false });
  const [name, setName] = useState<string>();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const saveName = useMutation({
    mutationFn: (displayName: string) => api.auth.updateName.mutate({ displayName }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['account'] }); setName(undefined); },
  });
  const revoke = useMutation({ mutationFn: () => api.auth.signOutOtherSessions.mutate(), onSuccess: () => setConfirmRevoke(false) });
  const guide = useMutation({ mutationFn: () => api.auth.showGuide.mutate(), onSuccess: () => client.invalidateQueries({ queryKey: ['account'] }) });
  const signOut = useMutation({ mutationFn: async () => {
    try { await api.auth.signOut.mutate(); } finally { await setSession(null); }
  } });
  if (loading) return <Page><Loading>Opening settings…</Loading></Page>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Page>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to profile" style={s.iconButton}
        onPress={() => router.dismissTo('/profile')}><Icon name="chevron-back" /></Pressable>
      <Text accessibilityRole="header" style={s.heading}>Settings</Text>
    </View>
    <View style={s.panel}>
      <Text style={s.label}>Account</Text>
      {details.isPending && <Text style={s.muted}>Loading account details…</Text>}
      {details.isError && <ErrorNotice retry={() => void details.refetch()}>Could not load account details.</ErrorNotice>}
      {details.data && <View style={s.field}><Text style={s.muted}>Verified school email</Text><Text selectable style={s.body}>{details.data.email}</Text></View>}
      {campus.data && <View style={s.field}><Text style={s.muted}>Campus</Text><Text style={s.body}>{campus.data.name}</Text></View>}
      {name === undefined ? <Button label="Edit display name" tone="quiet" onPress={() => { saveName.reset(); setName(account.data?.displayName ?? ''); }} /> : <>
        <TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} maxLength={40} style={s.input} autoComplete="given-name" />
        <View style={s.row}>
          <Button label="Cancel" tone="quiet" grow disabled={saveName.isPending} onPress={() => setName(undefined)} />
          <Button label={saveName.isPending ? 'Saving…' : 'Save name'} grow disabled={!name.trim() || saveName.isPending} onPress={() => saveName.mutate(name.trim())} />
        </View>
        {saveName.isError && <ErrorNotice>Could not save your name. Try again.</ErrorNotice>}
      </>}
    </View>
    <View style={s.panel}>
      <Text style={s.label}>Security</Text>
      {details.data?.hasPassword && <ChangePassword email={details.data.email} onUpdated={() => setPasswordUpdated(true)} />}
      {passwordUpdated && <Text accessibilityLiveRegion="polite" style={s.muted}>Password updated.</Text>}
      {details.data && !details.data.hasPassword && <Text style={s.muted}>Complete Sign up with your school email to set a password for this account.</Text>}
      {confirmRevoke ? <>
        <Text style={s.body}>Sign out on other devices and browsers? This session stays open.</Text>
        <View style={s.row}>
          <Button label="Cancel" tone="quiet" grow disabled={revoke.isPending} onPress={() => setConfirmRevoke(false)} />
          <Button label={revoke.isPending ? 'Signing out…' : 'Confirm'} grow disabled={revoke.isPending} onPress={() => revoke.mutate()} />
        </View>
      </> : <Button label="Sign out other sessions" tone="quiet" onPress={() => { revoke.reset(); setConfirmRevoke(true); }} />}
      {revoke.isSuccess && <Text accessibilityLiveRegion="polite" style={s.muted}>{revoke.data.revoked ? 'Other sessions signed out.' : 'There were no other sessions.'}</Text>}
      {revoke.isError && <ErrorNotice>Could not sign out other sessions. Try again.</ErrorNotice>}
      <Button label={signOut.isPending ? 'Signing out…' : 'Sign out'} tone="quiet" disabled={signOut.isPending || revoke.isPending} onPress={() => signOut.mutate()} />
    </View>
    <View style={s.panel}>
      <Text style={s.label}>Balance and payments</Text>
      <Text style={s.body}>This build uses test credits. Card deposits and cash withdrawals are unavailable.</Text>
      <Button label="View Portfolio" tone="quiet" onPress={() => router.dismissTo('/portfolio')} />
    </View>
    <View style={s.panel}>
      <Text style={s.label}>Help</Text>
      <Button label={guide.isPending ? 'Saving…' : 'Show the getting started guide again'} tone="quiet" disabled={guide.isPending} onPress={() => guide.mutate()} />
      {guide.isSuccess && <Text accessibilityLiveRegion="polite" style={s.muted}>The guide will appear in Feed.</Text>}
      {guide.isError && <ErrorNotice>Could not restore the guide. Try again.</ErrorNotice>}
    </View>
  </Page>;
}

function ChangePassword({ email, onUpdated }: { email: string; onUpdated: () => void }) {
  const { api, setSession } = useSession();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const send = useMutation({ mutationFn: () => api.auth.requestCode.mutate({ email, intent: 'reset' }),
    onSuccess: () => setCode(''),
  });
  const change = useMutation({ mutationFn: async (challengeId: string) => {
    const session = await api.auth.verifyCode.mutate({ challengeId, code, profile: { password } });
    await setSession(session.token, false);
    onUpdated();
  }, onSuccess: () => { setOpen(false); setCode(''); setPassword(''); } });
  if (!open) return <Button label="Change password" tone="quiet" onPress={() => { change.reset(); send.reset(); setOpen(true); }} />;
  return <View style={s.field}>
    <Text style={s.muted}>Verify your school email to change your password. This signs out other sessions.</Text>
    {send.data && <>
      <TextInput accessibilityLabel="Verification code" value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))} maxLength={6}
        autoComplete="one-time-code" keyboardType="number-pad" placeholder="Six-digit code" placeholderTextColor={c.muted} style={s.input} />
      <TextInput accessibilityLabel="New password" value={password} onChangeText={setPassword} maxLength={128}
        secureTextEntry autoComplete="new-password" autoCapitalize="none" placeholder="At least 12 characters" placeholderTextColor={c.muted} style={s.input} />
      <Button label={change.isPending ? 'Updating…' : 'Update password'} disabled={change.isPending || send.isPending || code.length !== 6 || password.length < 12}
        onPress={() => change.mutate(send.data.challengeId)} />
    </>}
    <Button label={send.isPending ? 'Sending…' : send.data ? 'Resend code' : 'Send verification code'} tone="quiet" disabled={send.isPending || change.isPending} onPress={() => send.mutate()} />
    <Button label="Cancel password change" tone="quiet" disabled={send.isPending || change.isPending}
      onPress={() => { setOpen(false); setCode(''); setPassword(''); send.reset(); change.reset(); }} />
    {(send.isError || change.isError) && <ErrorNotice>{studentError(change.error ?? send.error, 'Could not update your password. Try again.')}</ErrorNotice>}
  </View>;
}
