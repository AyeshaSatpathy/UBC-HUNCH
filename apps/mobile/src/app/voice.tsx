import { useMutation, useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { isOpen, money, shares, useAccount, useSession } from '../api';
import { Sheet } from '../sheet';
import { Button, c, ErrorNotice, Icon, Loading, Note, s } from '../ui';

export default function Voice() {
  const { api, loading, signedIn } = useSession();
  const account = useAccount();
  const [response, setResponse] = useState<'markets' | 'quote'>();
  const campusId = account.data?.campusId;
  const feed = useQuery({ queryKey: ['voice-markets', campusId], enabled: !!campusId,
    queryFn: ({ signal }) => api.markets.list.query({ campusId, limit: 20 }, { signal }) });
  const markets = feed.data?.items.filter(isOpen) ?? [];
  const featured = markets[0];
  const quote = useMutation({ mutationFn: () => api.markets.quote.query({ marketId: featured.id, side: 'YES', amountCents: 400 }),
    onSuccess: () => setResponse('quote') });
  if (loading) return <Sheet title="Ask Hunch"><Loading>Opening Hunch…</Loading></Sheet>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Sheet title="Ask Hunch">
    <View style={s.row}><Icon name="mic" color={c.lime} /><Text style={s.muted}>Choose a prompt</Text></View>
    <Button label="What’s open on my campus?" tone="quiet" onPress={() => setResponse('markets')} />
    <Button label="What would 4 dollars get me on YES?" tone="quiet" disabled={!featured || quote.isPending} onPress={() => quote.mutate()} />
    {quote.isPending && <Loading>Loading your quote…</Loading>}
    {quote.isError && <ErrorNotice retry={() => quote.mutate()}>Couldn’t load a quote.</ErrorNotice>}
    {response === 'markets' && (feed.isError || account.isError ? <ErrorNotice
      retry={() => { void account.refetch(); if (campusId) void feed.refetch(); }}>Couldn’t load your campus markets.</ErrorNotice>
      : feed.isPending ? <Loading>Loading markets…</Loading> : !markets.length ? <Note>There are no open markets on your campus.</Note>
      : <View style={s.panel}>
      <Text style={s.body}>Here’s what’s open.</Text>
      {markets.map(market => <Button key={market.id} label={market.question} tone="quiet" onPress={() =>
        router.replace({ pathname: '/market/[id]', params: { id: market.id } })} />)}
    </View>)}
    {response === 'quote' && featured && quote.data && <View style={s.panel}>
      <Text style={s.body}>On “{featured.question}” four dollars on YES would buy about {shares(quote.data.sharesMillionths)} shares.</Text>
      <Text style={s.muted}>{money(quote.data.feeCents)} fee · {money(quote.data.totalCents)} total</Text>
      <Button label="Open buy preview" onPress={() => router.replace({ pathname: '/buy', params: { id: featured.id, side: 'YES', amount: '4.00' } })} />
    </View>}
  </Sheet>;
}
