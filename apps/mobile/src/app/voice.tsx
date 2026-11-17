import { useMutation, useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { isOpen, money, shares, useAccount, useSession } from '../api';
import { Sheet } from '../sheet';
import { Button, c, Icon, s } from '../ui';

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
  if (loading) return null;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Sheet title="Ask Hunch">
    <View style={s.row}><Icon name="mic" color={c.lime} /><Text style={s.muted}>Choose a prompt</Text></View>
    <Button label="What’s open on my campus?" tone="quiet" onPress={() => setResponse('markets')} />
    <Button label="What would 4 dollars get me on YES?" tone="quiet" disabled={!featured || quote.isPending} onPress={() => quote.mutate()} />
    {quote.isError && <Text style={s.error}>{quote.error.message}</Text>}
    {response === 'markets' && <View style={s.panel}>
      <Text style={s.body}>{feed.isError ? 'Markets are temporarily unavailable.' :
        feed.isPending ? 'Loading markets…' : markets.length ? 'Here’s what’s open.' : 'There are no open markets on your campus.'}</Text>
      {markets.map(market => <Button key={market.id} label={market.question} tone="quiet" onPress={() =>
        router.replace({ pathname: '/market/[id]', params: { id: market.id } })} />)}
    </View>}
    {response === 'quote' && featured && quote.data && <View style={s.panel}>
      <Text style={s.body}>On “{featured.question}” four dollars on YES would buy about {shares(quote.data.sharesMillionths)} shares.</Text>
      <Text style={s.muted}>{money(quote.data.feeCents)} fee · {money(quote.data.totalCents)} total</Text>
      <Button label="Open buy preview" onPress={() => router.replace({ pathname: '/buy', params: { id: featured.id, side: 'YES', amount: '4.00' } })} />
    </View>}
  </Sheet>;
}
