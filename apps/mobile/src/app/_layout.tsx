import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { Intro } from '../intro';
import { c, Loading, Page } from '../ui';
import { SessionProvider, useSession } from '../api';

export default function Layout() {
  const [client] = useState(() => new QueryClient());
  const [loaded, error] = useFonts({ Bricolage: require('../../assets/fonts/Bricolage.ttf') });
  if (!loaded && !error) return <Page><Loading>Opening Hunch…</Loading></Page>;
  return <QueryClientProvider client={client}>
    <SessionProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="buy" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
      <LoginIntro />
      </View>
    </SessionProvider>
  </QueryClientProvider>;
}

function LoginIntro() {
  const { showIntro, finishIntro } = useSession();
  return showIntro ? <Intro onDone={finishIntro} /> : null;
}
