import { useMutation } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { studentError, useSession } from '../api';
import { Button, ErrorNotice, Icon, Loading, Page, Sticker, Wordmark, c, s } from '../ui';

export default function Onboarding() {
  const { api, loading, signedIn, setSession } = useSession();
  const [mode, setMode] = useState<'login' | 'signup' | 'recover'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const request = useMutation({
    mutationFn: () => api.auth.requestCode.mutate({ email: email.trim(), intent: mode === 'recover' ? 'reset' : 'signup' }),
    onSuccess: result => { setChallenge(result.challengeId); setCode(''); setCooldown(60); },
  });
  const login = useMutation({
    mutationFn: async () => { const session = await api.auth.login.mutate({ email: email.trim(), password }); await setSession(session.token); },
  });
  const verify = useMutation({
    mutationFn: async () => {
      const session = await api.auth.verifyCode.mutate({ challengeId: challenge, code,
        profile: { password, ...(mode === 'signup' ? { displayName: name.trim() } : {}) } });
      await setSession(session.token);
    },
  });
  if (loading) return <Page><Loading>Opening Hunch...</Loading></Page>;
  if (signedIn) return <Redirect href="/feed" />;
  const busy = request.isPending || login.isPending || verify.isPending;
  const validEmail = /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim());
  const reset = (next: typeof mode) => {
    setMode(next); setPassword(''); setCode(''); setChallenge(''); request.reset(); login.reset(); verify.reset();
  };
  const issue = verify.error ?? login.error ?? request.error;
  return <Page>
    <Wordmark />
    {!challenge && <View style={s.welcomeHero}>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={[s.heading, { fontSize: 38 }]}>Got a hunch?</Text>
        <Text style={s.body}>Make predictions with your campus. Follow the questions everyone is talking about.</Text>
      </View><Sticker size={100} />
    </View>}
    {!challenge && <View style={s.segment}>
      {(['login', 'signup'] as const).map(option => <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected: mode === option, disabled: busy }} disabled={busy}
        onPress={() => reset(option)} style={[s.button, { flex: 1, backgroundColor: mode === option ? c.lime : c.panel }]}>
        <Text style={[s.buttonText, { color: mode === option ? c.bg : c.cream }]}>{option === 'login' ? 'Log in' : 'Sign up'}</Text>
      </Pressable>)}
    </View>}
    <View style={s.panel}>
      <Text accessibilityRole="header" style={[s.heading, { fontSize: 26 }]}>{challenge ? 'One quick check' : mode === 'login' ? 'Good to have you back.' : mode === 'recover' ? 'A fresh start.' : 'Make yourself at home.'}</Text>
      <Text style={s.muted}>{challenge ? 'Enter the 6-digit code sent to ' + email + '. Your password will be saved once you verify.' : mode === 'login' ? 'Your campus, your picks, right where you left them.' : mode === 'recover' ? 'Verify your school email to reset your existing password.' : 'Choose a name and password. We will verify your school email next.'}</Text>
      {!challenge ? <>
        {mode === 'signup' && <View style={s.field}><Text style={s.muted}>What should we call you?</Text><TextInput accessibilityLabel="Your name" value={name} onChangeText={setName} maxLength={40} placeholder="First name or nickname" placeholderTextColor={c.muted} style={s.input} autoComplete="given-name" /></View>}
        <View style={s.field}><Text style={s.muted}>School email</Text><TextInput accessibilityLabel="School email" value={email} onChangeText={setEmail} placeholder="you@school.edu" placeholderTextColor={c.muted} style={s.input} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" /></View>
        <View style={s.field}><Text style={s.muted}>{mode === 'login' ? 'Password' : 'Choose a password'}</Text>
          <View style={{ position: 'relative' }}><TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Your password' : 'At least 12 characters'} placeholderTextColor={c.muted} maxLength={128} style={[s.input, { width: '100%', paddingRight: 56 }]} />
            <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} style={[s.iconButton, { position: 'absolute', right: 2, top: 2 }]} onPress={() => setShowPassword(!showPassword)}><Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} /></Pressable></View>
        </View>
        <Button label={busy ? 'Just a moment...' : mode === 'login' ? 'Log in' : 'Send verification code'} disabled={busy || !validEmail || password.length < (mode === 'login' ? 1 : 12) || (mode === 'signup' && !name.trim())} onPress={() => mode === 'login' ? login.mutate() : request.mutate()} />
        {mode === 'login' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => reset('recover')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' }}><Text style={[s.muted, { fontSize: 13, textDecorationLine: 'underline' }]}>Reset password</Text></Pressable>}
      </> : <>
        <TextInput accessibilityLabel="Verification code" placeholder="000000" placeholderTextColor={c.muted} value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" style={[s.input, { fontSize: 28, letterSpacing: 8, textAlign: 'center' }]} />
        <Button label={verify.isPending ? 'Verifying...' : mode === 'signup' ? 'Verify and join Hunch' : 'Save password and log in'} disabled={busy || code.length !== 6} onPress={() => verify.mutate()} />
        <View style={s.row}><Button label={cooldown ? 'Resend in ' + cooldown + 's' : 'Resend code'} grow tone="quiet" disabled={busy || cooldown > 0} onPress={() => request.mutate()} /><Button label="Edit details" grow tone="quiet" disabled={busy} onPress={() => { setChallenge(''); verify.reset(); request.reset(); }} /></View>
        <Text style={s.muted}>The code expires in 10 minutes. Check Spam if it has not arrived.</Text>
      </>}
      {!!issue && <ErrorNotice>{studentError(issue, 'Could not continue. Check your connection and try again.')}</ErrorNotice>}
    </View>
    {!challenge && <View style={[s.row, { justifyContent: 'center' }]}><Icon name="school-outline" color={c.lime} size={18} /><Text style={s.muted}>Your school email connects you to your campus.</Text></View>}
  </Page>;
}
