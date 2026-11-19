import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useSession } from './api';
import { ErrorNotice, c, s } from './ui';

const messages = {
  'school-email': 'Use a school-managed Google account from a supported campus, or continue with school email.',
  'account-missing': 'No Hunch account found. Open Sign up to join with Google.',
  cancelled: 'Google sign-in was canceled.',
  failed: 'Could not finish with Google. Try again or use school email.',
  expired: 'This Google request expired. Try again.',
} as const;

export function GoogleSignIn({ intent, disabled }: { intent: 'login' | 'signup'; disabled: boolean }) {
  const { api, setSession } = useSession();
  const [attempt, setAttempt] = useState<{ id: string; proof: string; url: string }>();
  const [starting, setStarting] = useState(false);
  const [needsTab, setNeedsTab] = useState(false);
  const [issue, setIssue] = useState('');
  const tab = useRef<Window | null>(null);

  useEffect(() => () => tab.current?.close(), []);
  useEffect(() => {
    if (!attempt) return;
    const { id, proof } = attempt;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.auth.googleStatus.mutate({ id, proof });
        if (!active) return;
        if (result.status === 'pending') { timer = setTimeout(poll, 1600); return; }
        tab.current?.close();
        setAttempt(undefined);
        if (result.status === 'approved') await setSession(result.token);
        else setIssue(messages[result.status]);
      } catch {
        if (!active) return;
        setAttempt(undefined);
        tab.current?.close();
        setIssue('Could not complete Google sign-in. Try again.');
      }
    }
    timer = setTimeout(poll, 1600);
    return () => { active = false; clearTimeout(timer); };
  }, [api, attempt, setSession]);

  async function start() {
    setIssue('');
    setStarting(true);
    if (Platform.OS === 'web') {
      tab.current = window.open('', '_blank');
      if (tab.current) tab.current.opener = null;
    }
    try {
      const next = await api.auth.googleStart.mutate({ intent });
      if (tab.current) tab.current.location.href = next.url;
      else if (Platform.OS !== 'web') await Linking.openURL(next.url);
      setNeedsTab(Platform.OS === 'web' && !tab.current);
      setAttempt(next);
    } catch (error) {
      tab.current?.close();
      setIssue(error instanceof Error && error.message.startsWith('Google sign-in is not configured')
        ? error.message : 'Could not open Google sign-in. Try again or use school email.');
    } finally { setStarting(false); }
  }

  const label = intent === 'login' ? 'Log in with Google' : 'Sign up with Google';
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || starting || !!attempt} onPress={() => void start()}
      style={({ pressed }) => [s.row, { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12, opacity: pressed || starting ? 0.7 : 1 }]}>
      <View style={{ width: 26, height: 26, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <Image source={require('../assets/google-g.png')} accessible={false} resizeMode="contain" style={{ width: 18, height: 18 }} />
      </View>
      <Text style={{ color: c.cream, fontWeight: '500', fontSize: 14 }}>{starting ? 'Opening Google…' : label}</Text>
    </Pressable>
    {attempt && <View style={s.row}>
      <Text style={s.muted}>Finish in your browser, then return to Hunch.</Text>
      {needsTab && <Pressable accessibilityRole="link" onPress={() => window.open(attempt.url, '_blank', 'noopener,noreferrer')}>
        <Text style={{ color: c.lilac }}>Open Google</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" onPress={() => { tab.current?.close(); setAttempt(undefined); }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: c.lilac }}>Cancel</Text>
      </Pressable>
    </View>}
    {!!issue && <ErrorNotice>{issue}</ErrorNotice>}
  </View>;
}
