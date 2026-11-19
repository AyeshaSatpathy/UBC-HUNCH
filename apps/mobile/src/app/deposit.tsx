import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { actionKey, money, studentError, useDepositHistory, usePortfolio, useSession } from '../api';
import { Button, ErrorNotice, Icon, Loading, Page, c, s } from '../ui';

const amounts = [500, 1000, 2500] as const;
const additionalCards = ['1111', '0002'] as const;
type Card = '4242' | (typeof additionalCards)[number];

export default function Deposit() {
  const { api, signedIn, loading } = useSession();
  const client = useQueryClient();
  const { id: existing } = useLocalSearchParams<{ id?: string }>();
  const history = useDepositHistory();
  const portfolio = usePortfolio();
  const [amount, setAmount] = useState<(typeof amounts)[number]>(1000);
  const [card, setCard] = useState<Card>('4242');
  const [addingCard, setAddingCard] = useState(false);
  const [newCard, setNewCard] = useState<(typeof additionalCards)[number]>('1111');
  const addCard = useMutation({
    mutationFn: () => api.deposits.addCard.mutate({ card: newCard }),
    onSuccess: async result => {
      await client.invalidateQueries({ queryKey: ['deposits'] });
      setCard(result.card);
      setAddingCard(false);
    },
  });
  const [requestKey] = useState(actionKey);
  const confirm = useMutation({
    mutationFn: () => api.deposits.confirm.mutate({ cents: amount, card, requestKey }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['deposits'] }),
    onError: () => { void client.invalidateQueries({ queryKey: ['deposits'] }); },
  });
  const id = existing ?? confirm.data?.id;
  const status = useQuery({ queryKey: ['deposit', id], enabled: signedIn && !!id, retry: false,
    queryFn: ({ signal }) => api.deposits.status.query({ id: id! }, { signal }),
    refetchInterval: ({ state }) => state.data?.status === 'pending' || !state.data ? 2500 : false,
  });
  const record = status.data ?? confirm.data;
  const confirmed = record?.status === 'confirmed';
  useEffect(() => {
    if (!confirmed) return;
    void client.invalidateQueries({ queryKey: ['deposits'] });
    void client.invalidateQueries({ queryKey: ['portfolio'] });
  }, [confirmed, client]);
  if (loading) return <Page><Loading>Opening checkout…</Loading></Page>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  const back = () => router.dismissTo('/portfolio');
  const pending = history.data?.deposits.find(item => item.status === 'pending');
  const rejected = confirm.error instanceof TRPCClientError && confirm.error.data?.code === 'BAD_REQUEST';
  const locked = confirm.isPending || (confirm.isError && !rejected);
  const canDeposit = history.data?.enabled && portfolio.data?.state === 'ready' && !pending && !addingCard;
  const savedCards: Card[] = history.data?.addedCard ? ['4242', history.data.addedCard] : ['4242'];
  return <Page>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Portfolio" style={s.iconButton} onPress={back}><Icon name="chevron-back" /></Pressable>
      <Text accessibilityRole="header" style={s.heading}>{id ? 'Deposit details' : 'Add funds'}</Text>
    </View>
    {id ? <>
      {record && <View style={[s.panel, { alignItems: 'center', paddingVertical: 24 }]}>
        <Icon name={confirmed ? 'checkmark-circle' : record.status === 'pending' ? 'time-outline' : 'alert-circle-outline'}
          size={44} color={confirmed || record.status === 'pending' ? c.lime : c.error} />
        <Text style={s.value}>{money(record.cents)}</Text>
        <Text accessibilityLiveRegion="polite" style={s.label}>{
          { confirmed: 'Deposit complete', pending: 'Deposit processing', declined: 'Card declined', failed: 'Deposit failed' }[record.status]
        }</Text>
        <Text style={s.muted}>Debit •••• {record.card}</Text>
        {confirmed && portfolio.isSuccess && portfolio.dataUpdatedAt >= status.dataUpdatedAt && portfolio.data.balanceCents != null && <Text style={s.body}>{money(portfolio.data.balanceCents)} available</Text>}
        {record.status === 'pending' && <Text style={[s.muted, { textAlign: 'center' }]}>Your funds will appear when the deposit confirms. You can check its status in Portfolio.</Text>}
        {(record.status === 'declined' || record.status === 'failed') && <Text style={s.muted}>No funds were added.</Text>}
      </View>}
      {status.isPending && !record && <Loading>Checking your deposit…</Loading>}
      {status.isError && <ErrorNotice retry={() => void status.refetch()}>Could not check your deposit.</ErrorNotice>}
      <Button label="View Portfolio" onPress={back} />
    </> : <>
      <View style={s.panel}>
        <Text style={s.label}>Choose an amount</Text>
        <View style={s.row}>{amounts.map(value => <Button key={value} grow label={money(value)} selected={amount === value}
          disabled={locked || !!pending} tone={amount === value ? 'lime' : 'quiet'} onPress={() => { confirm.reset(); setAmount(value); }} />)}</View>
      </View>
      <View style={s.panel}>
        <Text style={s.label}>Payment method</Text>
        {savedCards.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={'Card ending in ' + value}
          accessibilityState={{ checked: card === value, disabled: locked || !!pending }} disabled={locked || !!pending} onPress={() => { confirm.reset(); setCard(value); }}
          style={({ pressed }) => [s.row, s.between, { minHeight: 72, padding: 12, borderRadius: 12, borderWidth: 1,
            borderColor: card === value ? c.lilac : c.border, backgroundColor: '#252032', opacity: pressed ? 0.75 : 1 }]}>
          <View style={[s.row, { flex: 1 }]}>
            <Icon name="card-outline" size={26} color={c.lilac} />
            <View><Text style={s.muted}>Debit</Text><Text style={s.label}>•••• {value}</Text></View>
          </View>
          <Icon name={card === value ? 'checkmark-circle' : 'ellipse-outline'} color={card === value ? c.lilac : c.muted} />
        </Pressable>)}
        {addingCard ? <View style={s.field}>
          <Text style={s.muted}>Choose a preset card. No real charge.</Text>
          <View style={s.row}>{additionalCards.map(value => <Button key={value} label={'•••• ' + value} grow tone={newCard === value ? 'lilac' : 'quiet'}
            selected={newCard === value} disabled={addCard.isPending} onPress={() => setNewCard(value)} />)}</View>
          <View style={s.row}>
            <Button label="Cancel add card" grow tone="quiet" disabled={addCard.isPending} onPress={() => setAddingCard(false)} />
            <Button label={addCard.isPending ? 'Saving…' : 'Save card'} grow disabled={addCard.isPending} onPress={() => addCard.mutate()} />
          </View>
          {addCard.isError && <ErrorNotice>Could not save the card. Try again.</ErrorNotice>}
        </View> : <Button label="Add card" tone="quiet" disabled={locked || !!pending || !history.data?.enabled}
          onPress={() => { addCard.reset(); setAddingCard(true); }} />}
      </View>
      <View style={[s.row, s.between]}><Text style={s.label}>Total deposit</Text><Text style={s.label}>{money(amount)}</Text></View>
      <Text style={s.muted}>Testnet funds · No real charge</Text>
      {history.isError && <ErrorNotice retry={() => void history.refetch()}>Could not check deposit availability.</ErrorNotice>}
      {history.isSuccess && !history.data.enabled && <Text style={s.muted}>Deposits are unavailable.</Text>}
      {history.data?.enabled && portfolio.data?.state === 'pending' && <Text style={s.muted}>Deposits will be available after your account is ready.</Text>}
      {confirm.isError && !pending && <ErrorNotice>{studentError(confirm.error, 'Could not confirm your deposit. Try again or return to Portfolio to check its status.')}</ErrorNotice>}
      {pending ? <Button label="View pending deposit" onPress={() => router.setParams({ id: pending.id })} /> :
        <Button label={confirm.isPending ? 'Confirming…' : confirm.isError ? 'Retry deposit' : 'Confirm deposit'} disabled={confirm.isPending || !canDeposit} onPress={() => confirm.mutate()} />}
      <Button label="Cancel" tone="quiet" disabled={confirm.isPending} onPress={back} />
    </>}
  </Page>;
}
