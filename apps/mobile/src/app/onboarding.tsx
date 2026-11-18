import { useMutation } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { studentError, useSession } from '../api';
import { Button, ErrorNotice, Loading, Page, Sticker, Wordmark, c, s } from '../ui';

export default function Onboarding() {
  const { api, loading, signedIn, setSession } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallenge] = useState('');
  const request = useMutation({
    mutationFn: () => api.auth.requestCode.mutate({ email: email.trim() }),
    onSuccess: (result) => { setCode(''); setChallenge(result.challengeId); },
  });
  const verify = useMutation({
    mutationFn: async () => {
      const session = await api.auth.verifyCode.mutate({ challengeId, code });
      await setSession(session.token);
    },
  });
  if (loading) return <Page><Loading>Opening Hunch…</Loading></Page>;
  if (signedIn) return <Redirect href="/feed" />;
  const reset = () => { setChallenge(''); setCode(''); request.reset(); verify.reset(); };
  const issue = verify.error ? studentError(verify.error, 'Couldn’t verify the code. Try again.')
    : request.error ? studentError(request.error, 'Couldn’t send a code. Try again.') : null;
  return <Page>
    <Wordmark />
    {!challengeId && <View style={{ alignItems: 'center' }}><Sticker size={124} /></View>}
    <Text accessibilityRole="header" style={s.heading}>
      {challengeId ? 'Check your email' : 'Welcome to Hunch'}
    </Text>
    <Text style={s.body}>
      {challengeId ? 'Enter the six-digit code we sent to ' + email + '.' :
        'Sign in or join with your school email. We’ll find your campus from your email address.'}
    </Text>
    {!challengeId && <>
      <Text style={s.muted}>School email</Text>
      <TextInput accessibilityLabel="School email" placeholder="you@school.edu" value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email"
        placeholderTextColor={c.muted} style={s.input} />
      <Button label={request.isPending ? 'Sending…' : 'Send code'} disabled={request.isPending || !/^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim())} onPress={() => request.mutate()} />
    </>}
    {!!challengeId && <>
      <Text style={s.muted}>Verification code</Text>
      <TextInput accessibilityLabel="Verification code" value={code} placeholder="000000"
        onChangeText={(value) => setCode(value.replace(/\D/g, ''))} maxLength={6} keyboardType="number-pad"
        autoComplete="one-time-code" placeholderTextColor={c.muted}
        style={[s.input, { fontSize: 26, fontWeight: '700', letterSpacing: 8, textAlign: 'center' }]} />
      <Button label={verify.isPending ? 'Verifying…' : 'Verify and continue'} disabled={code.length !== 6 || verify.isPending || request.isPending} onPress={() => verify.mutate()} />
      <Button label="Resend code" tone="quiet" disabled={request.isPending || verify.isPending} onPress={() => { verify.reset(); request.mutate(); }} />
      <Button label="Change email" tone="quiet" disabled={verify.isPending || request.isPending} onPress={reset} />
    </>}
    {issue && <ErrorNotice>{issue}</ErrorNotice>}
  </Page>;
}
