import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { type Action, type Position, isSettled, money, shares, statusLabel, studentError, useAction, usePortfolio, useSession } from '../../api';
import { Button, ErrorNotice, Loading, Note, Page, s } from '../../ui';

function PendingAction({ item }: { item: Action }) {
  const action = useAction(item.id);
  const client = useQueryClient();
  const result = action.data?.status;
  useEffect(() => {
    if (result !== 'confirmed' && result !== 'failed') return;
    void client.invalidateQueries({ queryKey: ['portfolio'] });
    void client.invalidateQueries({ queryKey: ['markets'] });
  }, [client, result]);
  const name = item.kind === 'buy' ? 'Order' : item.kind === 'create' ? 'Market' : 'Prediction';
  return <View style={s.panel}>
    <Text style={s.body}>{name} {result === 'confirmed' ? 'confirmed' : result === 'failed' ? 'failed' : 'processing…'}</Text>
    {result === 'confirmed' && action.data?.marketId && <Button label="Open market" tone="quiet"
      onPress={() => router.push({ pathname: '/market/[id]', params: { id: action.data!.marketId! } })} />}
    {action.isError && <Button label="Check status" tone="quiet" onPress={() => void action.refetch()} />}
  </View>;
}

function Claim({ position }: { position: Position }) {
  const { api } = useSession();
  const client = useQueryClient();
  const id = position.market.id;
  const [requestId, setRequest] = useState<string>();
  const preview = useQuery({
    queryKey: ['claim', id], enabled: !position.claimed, retry: false,
    queryFn: ({ signal }) => api.claims.preview.query({ marketId: id }, { signal }),
  });
  const status = useQuery({
    queryKey: ['claim-status', requestId], enabled: !!requestId, retry: false,
    queryFn: ({ signal }) => api.claims.status.query({ requestId: requestId! }, { signal }),
    refetchInterval: ({ state }) => state.data?.status === 'confirmed' || state.data?.status === 'failed' ? false : 2_500,
  });
  const submit = useMutation({ mutationFn: () => api.claims.submit.mutate({ marketId: id }),
    onSuccess: result => setRequest(result.requestId) });
  useEffect(() => {
    if (status.data?.status === 'confirmed') void client.invalidateQueries({ queryKey: ['portfolio'] });
  }, [status.data?.status, client]);
  const refund = position.market.status === 'void';
  if (position.claimed || status.data?.status === 'confirmed' || preview.data?.status === 'claimed') {
    return <Text style={s.body}>{refund ? 'Refund collected' : 'Payout collected'}{status.data?.amountCents ? ' · ' + money(status.data.amountCents) : ''}</Text>;
  }
  const pending = !!requestId && status.data?.status !== 'failed';
  return <>
    {pending && <Text style={s.muted}>{refund ? 'Collecting your refund…' : 'Collecting your payout…'}</Text>}
    {preview.data?.status === 'available' && !pending && <>
      <Text style={s.body}>{refund ? 'Refund' : 'Payout'} {money(preview.data.amountCents)}</Text>
      <Button label={refund ? 'Collect refund' : 'Collect payout'} disabled={submit.isPending}
        onPress={() => submit.mutate()} />
    </>}
    {preview.isPending && !pending && <Text style={s.muted}>Checking what you can collect…</Text>}
    {preview.data?.status === 'unavailable' && <Text style={s.muted}>Nothing to collect for this market.</Text>}
    {(submit.error || status.data?.status === 'failed') && <Text accessibilityRole="alert" style={s.error}>{studentError(submit.error, 'Collection didn’t go through. Try again.')}</Text>}
    {preview.isError && <Button label="Check payout" tone="quiet" onPress={() => void preview.refetch()} />}
    {status.isError && <Button label="Check collection status" tone="quiet" onPress={() => void status.refetch()} />}
  </>;
}

export default function Portfolio() {
  const { api } = useSession();
  const data = usePortfolio();
  const pending = useQuery({ queryKey: ['pending-actions'], queryFn: ({ signal }) => api.actions.pending.query(undefined, { signal }) });
  const positions = data.data?.positions.filter(item => item.paidCents !== '0' || item.yesSharesMillionths !== '0' || item.noSharesMillionths !== '0') ?? [];
  return <Page tabbed>
    <Text accessibilityRole="header" style={s.heading}>Portfolio</Text>
    <View style={s.panel}>
      <Text style={s.muted}>Available balance</Text>
      {data.data?.balanceCents != null && <Text style={s.value} accessibilityLiveRegion="polite">{money(data.data.balanceCents)}</Text>}
      {data.data?.state === 'pending' && <Text style={s.muted}>Your account is being set up.</Text>}
    </View>
    {data.isPending && <Loading>Loading your portfolio…</Loading>}
    {data.isError && <ErrorNotice retry={() => void data.refetch()}>Couldn’t load your portfolio.</ErrorNotice>}
    {pending.isError && <ErrorNotice retry={() => void pending.refetch()}>Couldn’t check pending activity.</ErrorNotice>}
    {pending.data?.map(item => <PendingAction key={item.id} item={item} />)}
    {([['Open positions', false], ['Settled activity', true]] as const).map(([label, settled]) => {
      const entries = positions.filter(({ market }) => isSettled(market) === settled);
      return <View key={label} style={{ gap: 12 }}>
        <Text style={s.label}>{label}</Text>
        {!entries.length && data.isSuccess && <Note>{settled ? 'No settled activity yet.' : 'Your open positions will appear here.'}</Note>}
        {entries.map(position => <View key={position.market.id} style={s.panel}>
          <Text style={s.label}>{position.market.question}</Text>
          <Text style={s.muted}>{statusLabel(position.market)}</Text>
          <Text style={s.body}>{money(position.paidCents)} paid</Text>
          {position.yesSharesMillionths !== '0' && <Text style={s.body}>{shares(position.yesSharesMillionths)} YES shares</Text>}
          {position.noSharesMillionths !== '0' && <Text style={s.body}>{shares(position.noSharesMillionths)} NO shares</Text>}
          {settled && <Claim position={position} />}
        </View>)}
      </View>;
    })}
    <Button label="Browse markets" tone="quiet" onPress={() => router.navigate('/feed')} />
  </Page>;
}
