import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOpen, useAccount, useCampus, usePortfolio, useSavedMarkets, useSession } from '../../api';
import { MarketCard } from '../../markets';
import { Button, ErrorNotice, Icon, Loading, Note, Page, Wordmark, c, s } from '../../ui';

export default function Feed() {
  const { api } = useSession();
  const account = useAccount();
  const portfolio = usePortfolio();
  const campus = useCampus(account.data?.campusId);
  const [selected, select] = useState<'all' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const saved = useSavedMarkets();
  const client = useQueryClient();
  const guide = useMutation({ mutationFn: () => api.auth.dismissGuide.mutate(), onSuccess: () => client.invalidateQueries({queryKey:['account']}) });
  const filter = selected;
  const campusId = selected === 'all' ? undefined : account.data?.campusId;
  const feed = useInfiniteQuery({
    queryKey: ['markets', campusId],
    enabled: selected === 'all' || !!campusId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.markets.list.query({ campusId, before: pageParam, limit: 20 }, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 12_000,
  });
  const markets = feed.data?.pages.flatMap(page => page.items) ?? [];
  const featured = markets.find(isOpen);
  const activity = useQuery({ queryKey: ['activity', campusId],
    queryFn: ({ signal }) => api.activity.query({ campusId }, { signal }), refetchInterval: 5_000 });
  return <Page tabbed refreshing={refreshing} onRefresh={() => { setRefreshing(true); void Promise.all([feed.refetch(), portfolio.refetch(), activity.refetch(), saved.refetch()]).finally(() => setRefreshing(false)); }}>
    <View style={[s.row, s.between]}><Wordmark /><Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => router.navigate('/profile')}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.lilac, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={[s.label, { color: c.bg }]}>{account.data?.displayName?.slice(0, 1).toUpperCase() || 'H'}</Text>
    </Pressable></View>
    <View style={{ gap: 4 }}>
      <Text style={[s.heading, { fontSize: 44, lineHeight: 49 }]}>{account.data?.displayName ? 'Hey, ' + account.data.displayName + '.' : 'Right here. On campus.'}</Text>
      <Text style={s.muted}>See what everyone is calling. Make a few calls of your own.</Text>
    </View>
    <View style={s.row}>
      <Button label="All" grow selected={filter === 'all'} tone={filter === 'all' ? 'lime' : 'quiet'} onPress={() => select('all')} />
      <Button label="My campus" grow selected={selected === null} tone={selected === null ? 'lime' : 'quiet'} onPress={() => select(null)} />
    </View>
    {selected !== 'all' && campus.data && <Text style={s.muted}>{campus.data.name}</Text>}
    {account.data?.state === 'pending' && <Note>Your account is being set up. You can browse markets while you wait.</Note>}
    {account.data?.hasSeenGuide === false && <View style={s.panel}>
      <Text style={s.label}>Your first hunch</Text>
      <Text style={s.body}>Pick YES or NO on a question. Start with a free prediction, or buy shares in the outcome you believe in.</Text>
      <Text style={s.muted}>Each winning share pays $1. Losing shares pay $0. A 1% fee is shown before you confirm.</Text>
      <Button label="Got it" disabled={guide.isPending} onPress={() => guide.mutate()} />
      {guide.isError && <ErrorNotice>Could not save your preference. Please try again.</ErrorNotice>}
    </View>}
    {featured && <MarketCard featured market={featured} canBuy={account.data?.state === 'ready' && featured.campus.unitid === account.data.campusId} />}
    {markets.length > (featured ? 1 : 0) && <>
      <Text style={s.label}>Around campus</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {markets.filter(item => item !== featured).map(market => <View key={market.id} style={{ width: 270 }}><MarketCard market={market} /></View>)}
      </ScrollView>
    </>}
    {!!portfolio.data?.positions.length && <>
      <View style={[s.row, s.between]}><Text style={s.label}>Your picks</Text><Button label="View all" tone="quiet" onPress={() => router.navigate('/portfolio')} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {portfolio.data.positions.slice(0, 8).map(position => <View key={position.market.id} style={{ width: 270 }}><MarketCard market={position.market} /></View>)}
      </ScrollView>
    </>}
    {(feed.isError || account.isError) ? <ErrorNotice label="Retry feed"
      retry={() => { void account.refetch(); if (selected === 'all' || campusId) void feed.refetch(); }}>Couldn’t load the feed.</ErrorNotice>
      : feed.isPending ? <Loading>Loading markets…</Loading> : !markets.length && <Note>No markets here yet.</Note>}
    {feed.hasNextPage && <Button label={feed.isFetchingNextPage ? 'Loading more…' : 'Load more'} tone="quiet" disabled={feed.isFetchingNextPage} onPress={() => void feed.fetchNextPage()} />}
    <Text style={s.label}>Saved for later</Text>
    {saved.isPending ? <Loading>Loading saved markets...</Loading> : saved.isError ? <ErrorNotice retry={() => void saved.refetch()}>Could not load saved markets.</ErrorNotice> :
      !saved.data.length ? <Text style={s.muted}>Tap the bookmark on a market to keep it here.</Text> :
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {saved.data.map(market => <View key={market.id} style={{ width: 270 }}><MarketCard market={market} /></View>)}
      </ScrollView>}
    <Text style={s.label}>Live activity</Text>
    {activity.isPending ? <Loading>Loading activity…</Loading> :
      activity.isError ? <ErrorNotice retry={() => void activity.refetch()}>Couldn’t load activity.</ErrorNotice> :
      !activity.data.length ? <Note>When someone makes a move on campus, you will see it here.</Note> :
      activity.data.slice(0, 6).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/market/[id]', params: { id: item.marketId } })} style={{ minHeight: 64, paddingVertical: 10, gap: 4, borderBottomWidth: 1, borderColor: c.border }}>
        <Text style={s.muted}>{{ MarketCreated: 'New market', Purchased: 'New purchase', Finalized: 'Market settled', MarketFunded: 'Trading opened' }[item.kind]}</Text>
        <View style={s.row}><Text style={[s.body, { flex: 1 }]}>{item.question}</Text><Icon name="chevron-forward" size={18} color={c.muted} /></View>
      </Pressable>)}
  </Page>;
}
