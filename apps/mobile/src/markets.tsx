import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { type Market, isOpen, money, statusLabel } from './api';
import { Button, Icon, Sticker, c, s } from './ui';

export function BuyButtons({ market }: { market: Market }) {
  return <View style={s.row}>{(['YES', 'NO'] as const).map(side =>
    <Button key={side} grow tone={side === 'YES' ? 'lime' : 'lilac'} label={side + ' ' + money(side === 'YES' ? market.yesPercent : 100 - market.yesPercent)}
      onPress={() => router.push({ pathname: '/buy', params: { id: market.id, side } })} />
  )}</View>;
}

export function MarketCard({ market, featured = false, canBuy = false }: { market: Market; featured?: boolean; canBuy?: boolean }) {
  return <View style={s.panel}>
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/market/[id]', params: { id: market.id } })} style={{ gap: 10 }}>
      <View style={s.row}>
        <Icon name="location" color={c.lime} size={16} />
        <Text style={s.muted}>{market.campus.name}</Text>
      </View>
      <View style={[s.row, s.between]}>
        <Text style={[featured ? s.heading : s.label, { flex: 1, fontSize: featured ? 33 : 19 }]}>{market.question}</Text>
        {featured ? <Sticker size={118} /> : <Icon name="chevron-forward" color={c.muted} />}
      </View>
      {featured && market.status === 'open' && <>
        <Text style={[s.heading, { fontSize: 42, color: c.lime }]}>{market.yesPercent}% <Text style={{ color: c.cream, fontSize: 26 }}>YES</Text></Text>
        <View style={{ backgroundColor: c.lilac, height: 10, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ backgroundColor: c.lime, height: '100%', width: market.yesPercent + '%' as `${number}%`, borderRadius: 8 }} />
        </View>
      </>}
      {!featured && <Text style={s.muted}>{isOpen(market) ? 'YES ' + money(market.yesPercent) + '  ·  NO ' + money(100 - market.yesPercent) : statusLabel(market)}</Text>}
    </Pressable>
    {featured && canBuy && isOpen(market) && <BuyButtons market={market} />}
  </View>;
}
