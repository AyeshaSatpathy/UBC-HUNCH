import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { actionKey, isOpen, money, shares, studentError, useAccount, useAction, usePortfolio, useSession } from '../api';
import { Sheet } from '../sheet';
import { Button, ErrorNotice, Loading, c, s } from '../ui';

export default function Buy() {
  const { id, side: value, amount } = useLocalSearchParams<{ id: string; side: string; amount?: string }>();
  const [input, setInput] = useState(amount ?? '4.00');
  const { api, loading, signedIn } = useSession();
  const account = useAccount();
  const portfolio = usePortfolio();
  const client = useQueryClient();
  const [requestId, setRequest] = useState<string>();
  const operation = useAction(requestId);
  const detail = useQuery({ queryKey: ['market', id], enabled: signedIn && !!id,
    queryFn: ({ signal }) => api.markets.detail.query({ marketId: id }, { signal }) });
  const market = detail.data;
  const side = value === 'NO' ? 'NO' : 'YES';
  const cents = /^\d{1,6}(\.\d{0,2})?$/.test(input) ? Math.round(Number(input) * 100) : 0;
  type Quote = Awaited<ReturnType<typeof api.markets.quote.query>>;
  type Submission = { marketId: string; side: typeof side; cents: number; shares: string; requestKey: string; quote: Quote };
  const [submission, setSubmission] = useState<Submission>();
  const fixed = operation.data?.status === 'failed' ? undefined : submission;
  const quote = useQuery({ queryKey: ['quote', id, side, cents], enabled: signedIn && !!market && isOpen(market) && cents > 0,
    queryFn: ({ signal }) => api.markets.quote.query({ marketId: id, side, amountCents: cents }, { signal }),
    refetchInterval: fixed ? false : 6_000, retry: false });
  const estimate = fixed?.quote ?? quote.data;
  const buy = useMutation({
    mutationFn: ({ marketId, side, cents, shares, requestKey }: Submission) =>
      api.markets.buy.mutate({ marketId, side, cents, shares, requestKey }),
    onSuccess: (result) => setRequest(result.id),
    onError: (error) => {
      const code = error instanceof TRPCClientError ? error.data?.code : undefined;
      if (code === 'BAD_REQUEST' || code === 'CONFLICT' || code === 'PRECONDITION_FAILED') {
        setSubmission(undefined);
        void quote.refetch();
      }
    },
  });
  useEffect(() => {
    if (operation.data?.status !== 'confirmed') return;
    void client.invalidateQueries({ queryKey: ['portfolio'] });
    void client.invalidateQueries({ queryKey: ['market', id] });
    router.dismissTo('/portfolio');
  }, [operation.data?.status, client, id]);
  if (loading) return <Sheet title="Buy"><Loading>Opening Hunch…</Loading></Sheet>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  const active = !!requestId && operation.data?.status !== 'failed';
  const checking = !!fixed && !requestId && !buy.isPending;
  const available = portfolio.data?.balanceCents;
  const waiting = detail.isPending || account.isPending || portfolio.isPending;
  const issue = waiting ? '' : !market ? 'Market unavailable.' :
    !isOpen(market) ? 'Buying is closed for this market.' :
    account.isError || portfolio.isError ? 'Couldn’t check your available balance.' :
    account.data?.state !== 'ready' ? 'Your account is still being set up.' :
    market.campus.unitid !== account.data.campusId || !market.canParticipate ? 'Your account is ineligible for this market.' :
    !cents ? 'Enter a dollar amount with up to two decimal places.' :
    quote.isError ? 'Live quote unavailable. Try again.' :
    estimate && available != null && BigInt(estimate.totalCents) > BigInt(available) ? 'Insufficient balance.' : '';
  return <Sheet title={<>Buy <Text style={{ color: side === 'YES' ? c.lime : c.lilac }}>{side}</Text></>}>
    {market && <Text style={s.muted}>{market.question}</Text>}
    <View style={[s.row, s.between, s.panel]}>
      <Text style={s.label}>Amount</Text>
      <View style={[s.row, { gap: 2, flexShrink: 1 }]}>
        <Text style={s.label}>$</Text>
        <TextInput accessibilityLabel="Amount in dollars" keyboardType="decimal-pad" value={input}
          editable={!active && !buy.isPending && !checking} onChangeText={(next) => { setInput(next); buy.reset(); }}
          maxLength={9} selectTextOnFocus style={[s.label, { minWidth: 44, minHeight: 44, width: Math.max(44, input.length * 12), textAlign: 'right', padding: 0 }]} />
      </View>
    </View>
    <View style={[s.row, s.between]}><Text style={s.muted}>Estimated shares</Text><Text style={s.body}>{estimate ? shares(estimate.sharesMillionths) : '—'}</Text></View>
    <View style={[s.row, s.between]}><Text style={s.body}>Trading fee (1%)</Text><Text style={s.body}>{estimate ? money(estimate.feeCents) : '—'}</Text></View>
    <View style={s.divider} />
    <View style={[s.row, s.between]}><Text style={s.label}>Total</Text><Text style={s.label}>{estimate ? money(estimate.totalCents) : '—'}</Text></View>
    <Text style={s.muted}>If your choice wins, each share pays $1. If it loses, it pays $0.</Text>
    {available != null && <Text style={s.muted}>{money(available)} available</Text>}
    {waiting && !active && <Loading>Checking your balance and market…</Loading>}
    {!waiting && !issue && quote.isFetching && !estimate && <Loading>Loading your quote…</Loading>}
    {!active && (issue || buy.error || operation.data?.status === 'failed') && <ErrorNotice>
      {checking ? 'The order response was interrupted. Check the original order before trying another.' :
        issue || studentError(buy.error, 'The order didn’t go through. Review the current quote to try again.')}
    </ErrorNotice>}
    {(portfolio.isError || account.isError) && !active && <Button label="Retry balance" tone="quiet" onPress={() => { void portfolio.refetch(); void account.refetch(); }} />}
    {detail.isError && !active && <Button label="Retry market" tone="quiet" onPress={() => void detail.refetch()} />}
    {quote.isError && !active && <Button label="Refresh quote" tone="quiet" onPress={() => void quote.refetch()} />}
    {active && <Text accessibilityLiveRegion="polite" style={s.muted}>Your order is processing. You can check its status in Portfolio.</Text>}
    {operation.isError && <Button label="Check order status" tone="quiet" onPress={() => void operation.refetch()} />}
    <Button label={active || buy.isPending ? 'Processing…' : checking ? 'Check order' : 'Confirm'}
      disabled={buy.isPending || active || (!checking && (waiting || !!issue || !quote.data || available == null))}
      onPress={() => {
        if (checking && submission) { buy.mutate(submission); return; }
        if (!quote.data) return;
        const order: Submission = { marketId: id, side, cents, shares: quote.data.sharesMillionths, requestKey: actionKey(), quote: quote.data };
        setRequest(undefined);
        setSubmission(order);
        buy.mutate(order);
      }} />
  </Sheet>;
}
