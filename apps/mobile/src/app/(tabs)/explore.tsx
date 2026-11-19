import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../../api';
import { CampusSearch, type Campus } from '../../campuses';
import { MarketCard } from '../../markets';
import { Button, ErrorNotice, Loading, Note, Page, s } from '../../ui';

export default function Explore() {
  const { api } = useSession();
  const [campus, setCampus] = useState<Campus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const markets = useInfiniteQuery({
    queryKey: ['explore-markets', campus?.unitid], enabled: !!campus,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.markets.list.query({ campusId: campus!.unitid, before: pageParam, limit: 20 }, { signal }),
    getNextPageParam: page => page.nextCursor ?? undefined,
  });
  return <Page tabbed refreshing={refreshing} onRefresh={campus ? () => { setRefreshing(true); void markets.refetch().finally(() => setRefreshing(false)); } : undefined}>
    <Text accessibilityRole="header" style={s.heading}>{campus ? campus.name : 'Explore Campus'}</Text>
    {campus ? <>
      <Button label="Explore other campuses" tone="quiet" onPress={() => setCampus(null)} />
      {markets.isPending ? <Loading>Loading campus markets...</Loading> : markets.isError ? <ErrorNotice retry={() => void markets.refetch()}>Could not load these markets.</ErrorNotice> :
        !markets.data.pages[0].items.length ? <Note>No markets here yet. Check back soon.</Note> :
        markets.data.pages.flatMap(page => page.items).map(market => <MarketCard key={market.id} market={market} />)}
      {markets.hasNextPage && <Button label={markets.isFetchingNextPage ? 'Loading...' : 'Load more'} disabled={markets.isFetchingNextPage} tone="quiet" onPress={() => void markets.fetchNextPage()} />}
    </> : <CampusSearch onSelect={setCampus} />}
  </Page>;
}
