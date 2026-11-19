import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOpen, useAccount, useCampus, usePortfolio, useSession } from '../../api';
import { CampusSearch, type Campus } from '../../campuses';
import { MarketCard } from '../../markets';
import { Button, ErrorNotice, Icon, Loading, Note, Page, Wordmark, c, s } from '../../ui';

export default function Feed() {
  const { api } = useSession();
  const account = useAccount();
  const portfolio = usePortfolio();
  const campus = useCampus(account.data?.campusId);
  const [selected, select] = useState<Campus | 'all' | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const filter = selected ?? campus.data;
  const campusId = selected === 'all' ? undefined : selected?.unitid ?? account.data?.campusId;
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
  return <Page tabbed>
    <View style={[s.row, s.between]}><Wordmark /><Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => router.navigate('/profile')}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.lilac, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={[s.label, { color: c.bg }]}>{account.data?.displayName?.slice(0, 1).toUpperCase() || 'H'}</Text>
    </Pressable></View>
    <View style={{ gap: 4 }}><Text style={s.eyebrow}>YOUR DAILY CAMPUS FIX</Text>
      <Text style={s.heading}>{account.data?.displayName ? 'Hey, ' + account.data.displayName + '.' : 'Right here. On campus.'}</Text>
      <Text style={s.muted}>See what everyone is calling. Make a few calls of your own.</Text>
    </View>
    <View style={s.row}>
      <Button label="All" grow selected={filter === 'all'} tone={filter === 'all' ? 'lime' : 'quiet'} onPress={() => select('all')} />
      <Button label="My campus" grow selected={selected === null} tone={selected === null ? 'lime' : 'quiet'} onPress={() => select(null)} />
      <Button label={browsing ? 'Close search' : 'Find campus'} grow selected={browsing} tone="quiet" onPress={() => setBrowsing(!browsing)} />
    </View>
    {browsing && <CampusSearch onSelect={campus => { select(campus); setBrowsing(false); }} />}
    {filter && filter !== 'all' && <Text style={s.muted}>{filter.name}</Text>}
    {account.data?.state === 'pending' && <Note>Your account is being set up. You can browse markets while you wait.</Note>}
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
