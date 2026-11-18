import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { actionKey, dateLabel, isOpen, money, shares, statusLabel, studentError, type Side, useAccount, useAction, usePortfolio, useSession } from '../../api';
import { BuyButtons } from '../../markets';
import { Button, ErrorNotice, Loading, Page, s } from '../../ui';

export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, loading, signedIn } = useSession();
  const account = useAccount();
  const portfolio = usePortfolio();
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['market', id], enabled: signedIn && !!id,
    queryFn: ({ signal }) => api.markets.detail.query({ marketId: id }, { signal }), refetchInterval: 8_000 });
  const market = detail.data;
  const open = !!market && isOpen(market);
  const quotes = useQuery({ queryKey: ['detail-quotes', id], enabled: open, retry: false,
    queryFn: ({ signal }) => Promise.all((['YES', 'NO'] as const).map(side =>
      api.markets.quote.query({ marketId: id, side, amountCents: 100 }, { signal }))), refetchInterval: 8_000 });
  const [requestId, setRequest] = useState<string>();
  const predictionRequest = useRef<{ side: Side; key: string } | null>(null);
  const operation = useAction(requestId);
  const predict = useMutation({ mutationFn: (side: Side) => {
    if (predictionRequest.current?.side !== side) predictionRequest.current = { side, key: actionKey() };
    return api.markets.predict.mutate({ marketId: id, side, requestKey: predictionRequest.current.key });
  }, onSuccess: result => setRequest(result.id) });
  useEffect(() => {
    if (operation.data?.status === 'confirmed') void client.invalidateQueries({ queryKey: ['portfolio'] });
  }, [operation.data?.status, client]);
  if (loading) return <Page><Loading>Opening Hunch…</Loading></Page>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  if (!market) return <Page>
    {detail.isPending ? <Loading>Loading market…</Loading> :
      <ErrorNotice label="Check again" retry={() => void detail.refetch()}>This market isn’t available right now.</ErrorNotice>}
    <Button label="Back to feed" onPress={() => router.replace('/feed')} />
  </Page>;
  const eligible = open && market.canParticipate && account.data?.campusId === market.campus.unitid && account.data.state === 'ready';
  const prediction = portfolio.data?.positions.find(item => item.market.id === id)?.prediction ??
    (operation.data?.status === 'confirmed' ? predict.variables : undefined);
  const pending = !!requestId && (!operation.data || operation.data.status === 'pending');
  return <Page>
    <Button label="Back" tone="quiet" onPress={() => router.canGoBack() ? router.back() : router.replace('/feed')} />
    <Text style={s.muted}>{market.campus.name} · {statusLabel(market)}</Text>
    <Text accessibilityRole="header" style={s.heading}>{market.question}</Text>
    {market.status === 'draft' && <Text selectable style={s.muted}>Market #{market.id}</Text>}
    <View style={s.panel}>
      {open && <Text style={s.label}>{market.yesPercent}% YES · {100 - market.yesPercent}% NO</Text>}
      <Text style={s.muted}>Trading closes {dateLabel(market.closesAtUnix)}</Text>
      <Text style={s.muted}>Evidence deadline {dateLabel(market.evidenceDeadlineUnix)}</Text>
      {open && (quotes.data ? <>
        <Text style={s.body}>{money(quotes.data[0].totalCents)} total for {shares(quotes.data[0].sharesMillionths)} YES shares</Text>
        <Text style={s.body}>{money(quotes.data[1].totalCents)} total for {shares(quotes.data[1].sharesMillionths)} NO shares</Text>
      </> : quotes.isError ? <ErrorNotice label="Retry quotes" retry={() => void quotes.refetch()}>Live quotes are temporarily unavailable.</ErrorNotice>
        : <Text style={s.muted} accessibilityLiveRegion="polite">Loading live quotes…</Text>)}
      {eligible && <BuyButtons market={market} />}
      {open && !eligible && <Text style={s.muted}>{account.isPending ? 'Checking your account…' : account.data?.state === 'pending'
        ? 'Your account is being set up.' : `Buying and predictions require an eligible ${market.campus.name} account.`}</Text>}
    </View>
    <View style={s.panel}>
      <Text style={s.label}>What decides this?</Text>
      <Text style={s.body}>{market.source}</Text>
      <Text style={s.muted}>YES · {market.yesRule}</Text>
      <Text style={s.muted}>NO · {market.noRule}</Text>
    </View>
    <View style={s.panel}>
      <Text style={s.label}>Your prediction</Text>
      {prediction ? <Text style={s.body}>You picked {prediction}.</Text> : eligible ? <>
        <Text style={s.muted}>{pending ? 'Saving your prediction…' : 'Make a prediction without spending.'}</Text>
        <View style={s.row}>{(['YES', 'NO'] as const).map(side =>
          <Button key={side} grow label={'Predict ' + side} tone={side === 'YES' ? 'lime' : 'lilac'}
            disabled={predict.isPending || pending} onPress={() => {
              if (operation.data?.status === 'failed') predictionRequest.current = null;
              predict.mutate(side);
            }} />)}</View>
      </> : <Text style={s.muted}>Predictions are unavailable for this market.</Text>}
      {(operation.data?.status === 'failed' || predict.error) && <Text accessibilityRole="alert" style={s.error}>{studentError(predict.error, 'Your prediction wasn’t saved.')}</Text>}
      {operation.isError && <Button label="Check prediction status" tone="quiet" onPress={() => void operation.refetch()} />}
    </View>
  </Page>;
}
