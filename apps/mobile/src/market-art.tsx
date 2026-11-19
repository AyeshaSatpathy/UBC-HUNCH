import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Icon, c, s } from './ui';

const art = {
  campus: { source: require('../assets/markets/campus.png'), icon: 'school-outline', label: 'Campus life' },
  sports: { source: require('../assets/markets/sports.png'), icon: 'basketball-outline', label: 'Sports' },
  weather: { source: require('../assets/markets/weather.png'), icon: 'rainy-outline', label: 'Weather' },
  academics: { source: require('../assets/markets/academics.png'), icon: 'book-outline', label: 'Academics' },
} as const;

export function MarketArt({ question, height = 132 }: { question: string; height?: number }) {
  const category = /\b(rains?|rainy|snow|weather|temperatures?|storms?)\b/i.test(question) ? 'weather' :
    /\b(basketball|football|soccer|games?|tournament|championship|teams?|wins?)\b/i.test(question) ? 'sports' :
    /\b(library|exams?|classes?|study|academic|grades?|tuition)\b/i.test(question) ? 'academics' : 'campus';
  const item = art[category];
  const [ready, setReady] = useState(false);
  return <View style={{ height, width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg }}>
    {!ready && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name={item.icon} color={c.lilac} size={30} /><Text style={s.muted}>{item.label}</Text></View>}
    <Image key={category} source={item.source} accessible={false} resizeMode="cover" onLoad={() => setReady(true)} onError={() => setReady(false)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: ready ? 1 : 0 }} />
  </View>;
}
