import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import { type Market, isOpen, money, statusLabel, useSavedMarkets, useSession } from './api';
import { Button, ErrorNotice, Icon, c, s } from './ui';
import { MarketArt } from './market-art';

export function BuyButtons({ market }: { market: Market }) {
  return <View style={s.row}>{(['YES', 'NO'] as const).map(side =>
    <Button key={side} grow tone={side === 'YES' ? 'lime' : 'lilac'} label={side + ' ' + money(side === 'YES' ? market.yesPercent : 100 - market.yesPercent)}
      onPress={() => router.push({ pathname: '/buy', params: { id: market.id, side } })} />
  )}</View>;
}

export function MarketCard({ market, featured = false, canBuy = false }: { market: Market; featured?: boolean; canBuy?: boolean }) {
  const { api } = useSession();
  const saved = useSavedMarkets();
  const isSaved = saved.data?.some(item => item.id === market.id) ?? false;
  const client = useQueryClient();
  const bookmark = useMutation({ mutationFn: () => api.markets.save.mutate({ marketId: market.id, saved: !isSaved }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['saved-markets'] }),
  });
  return <View style={s.panel}>
    <View style={s.row}>
      <Icon name="location" color={c.lime} size={16} /><Text style={[s.muted, { flex: 1 }]}>{market.campus.name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={(isSaved ? 'Unsave market: ' : 'Save market: ') + market.question} accessibilityState={{ selected: isSaved, disabled: bookmark.isPending || saved.isPending || saved.isError }}
        disabled={bookmark.isPending || saved.isPending || saved.isError} onPress={() => bookmark.mutate()} style={s.iconButton}><Icon name={isSaved ? 'bookmark' : 'bookmark-outline'} color={isSaved ? c.lime : c.cream} /></Pressable>
    </View>
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/market/[id]', params: { id: market.id } })}
      style={({ pressed }) => ({ minHeight: 44, gap: 12, opacity: pressed ? 0.78 : 1 })}>
      <MarketArt question={market.question} height={featured ? 150 : 88} />
      <View style={[s.row, s.between]}>
        <Text style={[featured ? s.heading : s.label, { flex: 1 }]}>{market.question}</Text>
        {!featured && <Icon name="chevron-forward" color={c.muted} />}
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
    {bookmark.isError && <ErrorNotice>Could not update your saved markets. Please try again.</ErrorNotice>}
  </View>;
}
