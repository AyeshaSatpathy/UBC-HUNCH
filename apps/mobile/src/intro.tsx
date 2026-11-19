import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View, useWindowDimensions } from 'react-native';
import { c, s } from './ui';

export function Intro({ onDone }: { onDone: () => void }) {
  const [expand] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(1));
  const { width, height } = useWindowDimensions();
  const coverScale = (Math.hypot(width, height) * 2 + 20) / 13;
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => true).then(reduced => {
      if (!active) return;
      if (reduced) { onDone(); return; }
      animation = Animated.sequence([
        Animated.delay(220),
        Animated.timing(expand, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(110),
        Animated.timing(fade, { toValue: 0, duration: 230, useNativeDriver: true }),
      ]);
      animation.start(({ finished }) => { if (finished && active) onDone(); });
    });
    return () => { active = false; animation?.stop(); };
  }, [onDone, expand, fade]);
  return <Animated.View accessibilityLabel="Hunch is opening" style={{ position: 'absolute', inset: 0, zIndex: 100, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center', opacity: fade }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[s.heading, { fontSize: 72, letterSpacing: -4 }]}>hunch</Text>
      <Animated.View testID="hunch-intro-dot" style={{ width: 13, height: 13, borderRadius: 6.5, marginLeft: 6, marginTop: 29, backgroundColor: c.lime,
        transform: [{ scale: expand.interpolate({ inputRange: [0, 1], outputRange: [1, coverScale] }) }] }} />
    </View>
  </Animated.View>;
}
