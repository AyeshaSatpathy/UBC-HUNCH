import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const c = { bg: '#0D0D0E', panel: '#181819', border: '#514D49', cream: '#FFF4E2', muted: '#CCC5BC', lime: '#DCFF3E', lilac: '#CBA5F9', error: '#FFAEAB' };
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, gap: 16 },
  panel: { backgroundColor: c.panel, borderColor: c.border, borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: { gap: 8 },
  eyebrow: { color: c.lime, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, lineHeight: 16, flexShrink: 1 },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 18, backgroundColor: c.panel },
  welcomeHero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  between: { justifyContent: 'space-between' },
  body: { fontSize: 16, lineHeight: 23, color: c.cream, flexShrink: 1 },
  muted: { color: c.muted, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  heading: { color: c.cream, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 32, letterSpacing: -0.8 },
  label: { color: c.cream, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 18, lineHeight: 24, flexShrink: 1 },
  value: { color: c.lime, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 46 },
  input: { color: c.cream, minHeight: 48, fontSize: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, backgroundColor: c.panel },
  button: { minHeight: 48, minWidth: 44, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: c.bg, fontFamily: 'Bricolage', fontWeight: '800', fontSize: 16, textAlign: 'center' },
  iconButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14 },
  divider: { height: 1, backgroundColor: c.border },
  error: { color: c.error, fontSize: 15, lineHeight: 21 },
});

export function Page({ children, tabbed = false, onRefresh, refreshing = false }: { children: ReactNode; tabbed?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  return <SafeAreaView edges={tabbed ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']} style={s.screen}>
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.lime} colors={[c.lime]} /> : undefined}>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

export function Button({ label, onPress, tone = 'lime', disabled = false, grow = false, selected }: {
  label: string; onPress: () => void; tone?: 'lime' | 'lilac' | 'quiet'; disabled?: boolean; grow?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: disabled ? c.panel : tone === 'quiet' ? c.panel : c[tone], opacity: pressed ? 0.8 : 1, flex: grow ? 1 : undefined, borderWidth: tone === 'quiet' || disabled ? 1 : 0, borderColor: c.border }]}>
    <Text style={[s.buttonText, tone === 'quiet' && { color: c.cream }, disabled && { color: c.muted }]}>{label}</Text>
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
  return <View style={s.panel}><Text style={s.body} accessibilityLiveRegion="polite">{children}</Text></View>;
}

export function Loading({ children }: { children: string }) {
  return <View style={[s.panel, s.row]} testID="loading-state">
    <ActivityIndicator color={c.lime} />
    <Text style={s.body} accessibilityLiveRegion="polite">{children}</Text>
  </View>;
}

export function ErrorNotice({ children, retry, label = 'Try again' }: { children: string; retry?: () => void; label?: string }) {
  return <View style={s.panel} testID="error-state">
    <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{children}</Text>
    {retry && <Button label={label} tone="quiet" onPress={retry} />}
  </View>;
}
