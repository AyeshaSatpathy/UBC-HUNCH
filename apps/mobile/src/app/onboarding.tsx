import { useMutation } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { studentError, useSession } from '../api';
import { Button, ErrorNotice, Icon, Loading, Page, Sticker, c, s } from '../ui';

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
  const [submitted, setSubmitted] = useState(false);
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
  const nameError = mode === 'signup' && !name.trim() ? 'Enter your name or nickname.' : '';
  const emailError = !/^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim()) || email.trim().length > 254
    ? 'Enter a valid school email ending in .edu.' : '';
  const passwordError = mode === 'login'
    ? (password.length === 0 ? 'Enter your password.' : '')
    : (password.length < 12 ? 'Use at least 12 characters for your password.' : '');
  const submit = () => {
    setSubmitted(true);
    if (nameError || emailError || passwordError) return;
    if (mode === 'login') login.mutate();
    else request.mutate();
  };
  const reset = (next: typeof mode) => {
    if (next === mode) return;
    setSubmitted(false);
    setShowPassword(false);
    setMode(next); setPassword(''); setCode(''); setChallenge(''); request.reset(); login.reset(); verify.reset();
  };
  const issue = verify.error ?? login.error ?? request.error;
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <Image source={require('../../assets/auth-wave.png')} accessible={false} resizeMode="stretch" style={styles.wave} />
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text accessibilityLabel="Hunch" style={styles.wordmark}>hunch<Text style={{ color: c.lime }}>.</Text></Text>
        {!challenge && <Sticker size={124} />}
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.heading}>{challenge ? 'One quick check' : mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create an account' : 'Reset password'}</Text>
          <Text style={styles.subtitle}>{challenge ? 'Enter the six-digit code sent to ' + email.trim() + '.' : mode === 'login' ? 'Sign in to your Hunch account.' : mode === 'signup' ? 'Join with your school email.' : 'Verify your school email.'}</Text>
        </View>
      </View>
      <View style={styles.form}>
        {!challenge ? <>
          {mode === 'signup' && <AuthField icon="person-outline" accessibilityLabel="Your name" placeholder="Your name" value={name}
            onChangeText={setName} maxLength={40} autoComplete="given-name" error={submitted ? nameError : ''} />}
          <AuthField icon="mail-outline" accessibilityLabel="School email" placeholder="School email" value={email}
            onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" error={submitted ? emailError : ''} />
          <AuthField icon="lock-closed-outline" accessibilityLabel="Password" placeholder={mode === 'recover' ? 'New password' : 'Password'}
            value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={128} error={submitted ? passwordError : ''}
            visibility={{ visible: showPassword, toggle: () => setShowPassword(value => !value) }} />
          {mode !== 'login' && !(submitted && passwordError) && <Text style={s.muted}>At least 12 characters.</Text>}
          {mode === 'login' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => reset('recover')} style={styles.forgot}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>}
          <Button label={request.isPending ? 'Sending code…' : login.isPending ? 'Logging in…' : mode === 'login' ? 'Log in' : 'Send verification code'} disabled={busy} onPress={submit} />
        </> : <>
          <TextInput accessibilityLabel="Verification code" placeholder="000000" placeholderTextColor={c.muted} value={code}
            onChangeText={value => setCode(value.replace(/\D/g, ''))} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code"
            style={[s.input, { fontSize: 28, letterSpacing: 8, textAlign: 'center' }]} />
          <Button label={verify.isPending ? 'Verifying…' : mode === 'signup' ? 'Verify and join Hunch' : 'Save password and log in'}
            disabled={busy || code.length !== 6} onPress={() => verify.mutate()} />
          <Text style={s.muted}>The code expires in 10 minutes. Check Spam if it has not arrived.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || cooldown > 0 }} disabled={busy || cooldown > 0}
            onPress={() => request.mutate()} style={styles.resend}>
            <Text style={styles.resendText}>{request.isPending ? 'Sending…' : cooldown ? 'Resend in ' + cooldown + 's' : 'Resend code'}</Text>
          </Pressable>
        </>}
        {!!issue && <ErrorNotice>{studentError(issue, 'Could not continue. Check your connection and try again.')}</ErrorNotice>}
      </View>
      {!challenge && <View style={styles.footer}>
        {mode !== 'recover' && <Text style={s.body}>{mode === 'login' ? 'New to Hunch?' : 'Already have an account?'}</Text>}
        <Pressable accessibilityRole="link" disabled={busy} onPress={() => reset(mode === 'login' ? 'signup' : 'login')} style={styles.footerLink}>
          <Text style={styles.link}>{mode === 'login' ? 'Create an account' : mode === 'signup' ? 'Log in' : 'Back to log in'}</Text>
        </Pressable>
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

function AuthField({ icon, error, visibility, ...input }: TextInputProps & {
  icon: 'person-outline' | 'mail-outline' | 'lock-closed-outline';
  error: string;
  visibility?: { visible: boolean; toggle: () => void };
}) {
  return <View style={s.field}>
    <View style={styles.inputFrame}>
      <Icon name={icon} color={c.cream} size={21} />
      <TextInput {...input} placeholderTextColor={c.muted} style={styles.input} />
      {visibility && <Pressable accessibilityRole="button" accessibilityLabel={visibility.visible ? 'Hide password' : 'Show password'}
        onPress={visibility.toggle} style={s.iconButton}><Icon name={visibility.visible ? 'eye-off-outline' : 'eye-outline'} /></Pressable>}
    </View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  wave: { position: 'absolute', bottom: 0, left: 0, width: '100%', height: 66 },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 82, gap: 24 },
  hero: { alignItems: 'center', gap: 14 },
  wordmark: { ...s.heading, fontSize: 54, letterSpacing: -2.5, lineHeight: 58 },
  intro: { alignItems: 'center', gap: 4 },
  heading: { ...s.heading, fontSize: 32, textAlign: 'center' },
  subtitle: { ...s.body, color: c.muted, textAlign: 'center' },
  form: { gap: 11 },
  inputFrame: { ...s.input, ...s.row, gap: 12, paddingVertical: 0, paddingRight: 5 },
  input: { flex: 1, minWidth: 0, minHeight: 48, color: c.cream, fontSize: 16, paddingVertical: 0 },
  forgot: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', marginTop: -5 },
  forgotText: { ...s.body, fontSize: 14, textDecorationLine: 'underline' },
  footer: { ...s.row, justifyContent: 'center', flexWrap: 'wrap', marginTop: -9 },
  footerLink: { minHeight: 44, justifyContent: 'center' },
  link: { ...s.body, color: c.lilac, fontWeight: '700', textDecorationLine: 'underline' },
  resend: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  resendText: { color: c.lime, fontWeight: '700', fontSize: 12 },
});
