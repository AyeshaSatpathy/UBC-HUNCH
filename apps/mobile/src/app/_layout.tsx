import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { c } from '../ui';
import { SessionProvider } from '../api';

export default function Layout() {
  const [client] = useState(() => new QueryClient());
  const [loaded, error] = useFonts({ Bricolage: require('../../assets/fonts/Bricolage.ttf') });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return <QueryClientProvider client={client}>
    <SessionProvider>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="buy" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      <Stack.Screen name="voice" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
    </SessionProvider>
  </QueryClientProvider>;
}
