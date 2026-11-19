import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Intro } from '../intro';
import { c, Loading, Page } from '../ui';
import { SessionProvider } from '../api';

export default function Layout() {
  const [client] = useState(() => new QueryClient());
  const [intro, setIntro] = useState(true);
  const finishIntro = useCallback(() => setIntro(false), []);
  const [loaded, error] = useFonts({ Bricolage: require('../../assets/fonts/Bricolage.ttf') });
  if (!loaded && !error) return <Page><Loading>Opening Hunch…</Loading></Page>;
  return <QueryClientProvider client={client}>
    <SessionProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="buy" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
      {intro && <Intro onDone={finishIntro} />}
      </View>
    </SessionProvider>
  </QueryClientProvider>;
}
