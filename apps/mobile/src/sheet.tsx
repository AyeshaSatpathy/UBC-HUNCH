import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { c, Icon, s } from './ui';

export function closeSheet() {
  if (router.canGoBack()) router.back();
  else router.replace('/feed');
}

export function Sheet({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { top } = useSafeAreaInsets();
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', paddingTop: top + 12 }}>
    <Pressable accessible={false} focusable={false} onPress={closeSheet} style={{ position: 'absolute', inset: 0, backgroundColor: '#0009' }} />
    <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityViewIsModal style={{ backgroundColor: c.panel, borderColor: c.border, borderWidth: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, width: '100%', maxWidth: 520, maxHeight: '94%', alignSelf: 'center' }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View style={{ width: 38, height: 4, borderRadius: 3, backgroundColor: c.muted, alignSelf: 'center' }} />
        <View style={[s.row, s.between]}>
          <Text accessibilityRole="header" style={[s.heading, { flexShrink: 1 }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeSheet}
            style={({ pressed }) => [s.iconButton, { backgroundColor: pressed ? c.border : c.bg }]}><Icon name="close" /></Pressable>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  </KeyboardAvoidingView>;
}
