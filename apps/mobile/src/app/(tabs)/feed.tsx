import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { isOpen, useAccount, useCampus, useSession } from '../../api';
import { CampusSearch, type Campus } from '../../campuses';
import { MarketCard } from '../../markets';
import { Button, ErrorNotice, Loading, Note, Page, Wordmark, s } from '../../ui';

export default function Feed() {
  const { api } = useSession();
  const account = useAccount();
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
    <Wordmark />
    <View style={s.row}>
      <Button label="All" grow selected={filter === 'all'} tone={filter === 'all' ? 'lime' : 'quiet'} onPress={() => select('all')} />
      <Button label="My campus" grow selected={selected === null} tone={selected === null ? 'lime' : 'quiet'} onPress={() => select(null)} />
      <Button label={browsing ? 'Close search' : 'Find campus'} grow selected={browsing} tone="quiet" onPress={() => setBrowsing(!browsing)} />
    </View>
    {browsing && <CampusSearch onSelect={campus => { select(campus); setBrowsing(false); }} />}
    {filter && filter !== 'all' && <Text style={s.muted}>{filter.name}</Text>}
    {account.data?.state === 'pending' && <Note>Your account is being set up. You can browse markets while you wait.</Note>}
    {featured && <MarketCard featured market={featured} canBuy={account.data?.state === 'ready' && featured.campus.unitid === account.data.campusId} />}
    {markets.length > (featured ? 1 : 0) && <Text style={s.label}>More markets</Text>}
    {markets.filter(item => item !== featured).map(market => <MarketCard key={market.id} market={market} />)}
    {(feed.isError || account.isError) ? <ErrorNotice label="Retry feed"
      retry={() => { void account.refetch(); if (selected === 'all' || campusId) void feed.refetch(); }}>Couldn’t load the feed.</ErrorNotice>
      : feed.isPending ? <Loading>Loading markets…</Loading> : !markets.length && <Note>No markets here yet.</Note>}
    {feed.hasNextPage && <Button label={feed.isFetchingNextPage ? 'Loading more…' : 'Load more'} tone="quiet" disabled={feed.isFetchingNextPage} onPress={() => void feed.fetchNextPage()} />}
    <Text style={s.label}>Live activity</Text>
    {activity.isPending ? <Loading>Loading activity…</Loading> :
      activity.isError ? <ErrorNotice retry={() => void activity.refetch()}>Couldn’t load activity.</ErrorNotice> :
      !activity.data.length ? <Note>No activity yet.</Note> :
      activity.data.map(item => <View key={item.id} style={s.panel}>
        <Text style={s.muted}>{{ MarketCreated: 'New market', Purchased: 'New purchase', Finalized: 'Market settled', MarketFunded: 'Trading opened' }[item.kind]}</Text>
        <Button tone="quiet" label={item.question} onPress={() => router.push({ pathname: '/market/[id]', params: { id: item.marketId } })} />
      </View>)}
  </Page>;
}
