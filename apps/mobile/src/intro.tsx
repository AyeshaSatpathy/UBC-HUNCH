import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import { c, s } from './ui';

export function Intro({ onDone }: { onDone: () => void }) {
  const [reveal] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => true).then(reduced => {
      if (!active) return;
      if (reduced) { onDone(); return; }
      animation = Animated.sequence([
        Animated.timing(reveal, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(350),
        Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]);
      animation.start(({ finished }) => { if (finished && active) onDone(); });
    });
    return () => { active = false; animation?.stop(); };
  }, [onDone, reveal, fade]);
  return <Animated.View accessibilityLabel="Hunch is opening" style={{ position: 'absolute', inset: 0, zIndex: 100, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center', opacity: fade }}>
    <Animated.View style={{ opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }, { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
      <Text style={[s.heading, { fontSize: 72, letterSpacing: -4 }]}>hunch<Text style={{ color: c.lime }}>.</Text></Text>
      <View style={{ height: 3, backgroundColor: c.lime, borderRadius: 2, marginTop: 6 }} />
      <Text style={[s.muted, { textAlign: 'center', marginTop: 18 }]}>Your campus. Your call.</Text>
    </Animated.View>
  </Animated.View>;
}
