import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const c = { bg: '#0D0D0E', panel: '#181819', border: '#353436', cream: '#FFF4E2', muted: '#BCB6AE', lime: '#DCFF3E', lilac: '#CBA5F9' };
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 18, gap: 16 },
  panel: { backgroundColor: c.panel, borderColor: c.border, borderWidth: 1, borderRadius: 22, padding: 17, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { justifyContent: 'space-between' },
  body: { fontSize: 16, color: c.cream, flexShrink: 1 },
  muted: { color: c.muted, fontSize: 14, flexShrink: 1 },
  heading: { color: c.cream, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 34, letterSpacing: -1.2 },
  label: { color: c.cream, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 19, flexShrink: 1 },
  input: { color: c.cream, fontSize: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, backgroundColor: c.panel },
  button: { minHeight: 49, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: c.bg, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 17, textAlign: 'center' },
  divider: { height: 1, backgroundColor: c.border },
  error: { color: '#FFAEAB', fontSize: 15 },
});

export function Page({ children }: { children: ReactNode }) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{children}</ScrollView></SafeAreaView>;
}

export function Button({ label, onPress, tone = 'lime', disabled = false, grow = false }: {
  label: string; onPress: () => void; tone?: 'lime' | 'lilac' | 'quiet'; disabled?: boolean; grow?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: tone === 'quiet' ? c.panel : c[tone], opacity: disabled ? 0.45 : pressed ? 0.78 : 1, flex: grow ? 1 : undefined, borderWidth: tone === 'quiet' ? 1 : 0, borderColor: c.border }]}>
    <Text style={[s.buttonText, tone === 'quiet' && { color: c.cream }]}>{label}</Text>
  </Pressable>;
}

export function Icon({ name, color = c.cream, size = 22 }: { name: keyof typeof Ionicons.glyphMap; color?: string; size?: number }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Wordmark() {
  return <Text accessibilityRole="header" style={[s.heading, { fontSize: 44 }]}>hunch<Text style={{ color: c.lime }}>.</Text></Text>;
}

export function Sticker({ size }: { size: number }) {
  return <Image source={require('../assets/hunch-ticket.png')} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />;
}

export function Note({ children }: { children: ReactNode }) {
  return <View style={s.panel}><Text style={s.muted}>{children}</Text></View>;
}
