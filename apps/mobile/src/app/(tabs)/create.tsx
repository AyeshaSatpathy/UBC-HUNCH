import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { actionKey, dateLabel, useAccount, useAction, useCampus, useSession } from '../../api';
import { Button, Page, c, s } from '../../ui';

const fields = [
  ['question', 'Question', 'Will the campus café extend its hours?'],
  ['source', 'Official source', 'Announcement or official results page'],
  ['yesRule', 'YES rule', 'What would make YES win?'],
  ['noRule', 'NO rule', 'What would make NO win?'],
  ['closesAt', 'Trading close', 'YYYY-MM-DD HH:MM'],
  ['evidenceAt', 'Evidence deadline', 'YYYY-MM-DD HH:MM'],
] as const;

function localDate(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return NaN;
  const date = new Date(trimmed.replace(' ', 'T'));
  if (!Number.isFinite(date.getTime())) return NaN;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace('T', ' ');
  return local === trimmed ? date.getTime() : NaN;
}

export default function Create() {
  const [form, setForm] = useState(() => ({ question: '', source: '', yesRule: '', noRule: '', closesAt: localDate(2), evidenceAt: localDate(4) }));
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const { api } = useSession();
  const client = useQueryClient();
  const account = useAccount();
  const campus = useCampus(account.data?.campusId);
  const [requestId, setRequest] = useState<string>();
  const operation = useAction(requestId);
  const key = useRef({ value: '', form: '' });
  const create = useMutation({
    mutationFn: () => {
      const fingerprint = JSON.stringify(form);
      if (key.current.form !== fingerprint) key.current = { value: actionKey(), form: fingerprint };
      return api.markets.create.mutate({
        requestKey: key.current.value, question: form.question, source: form.source,
        yesRule: form.yesRule, noRule: form.noRule, close: Math.floor(parseDate(form.closesAt) / 1000),
        deadline: Math.floor(parseDate(form.evidenceAt) / 1000),
      });
    },
    onSuccess: (result) => setRequest(result.id),
  });
  const resultId = operation.data?.status === 'confirmed' ? operation.data.marketId : null;
  useEffect(() => {
    if (resultId) void client.invalidateQueries({ queryKey: ['markets'] });
  }, [resultId, client]);
  const pending = !!requestId && (!operation.data || operation.data.status === 'pending');
  const submit = () => {
    const close = parseDate(form.closesAt);
    const evidence = parseDate(form.evidenceAt);
    if (Object.values(form).some(value => !value.trim())) return setError('Complete every field.');
    if (!(close > Date.now() && evidence > close)) return setError('Use local dates in YYYY-MM-DD HH:MM format. The deadline must follow the future trading close.');
    setError('');
    if (!review) return setReview(true);
    if (operation.data?.status === 'failed') { key.current = { value: '', form: '' }; setRequest(undefined); }
    create.mutate();
  };
  return <Page>
    {campus.data && <Text style={s.muted}>{campus.data.name}</Text>}
    <Text accessibilityRole="header" style={s.heading}>{review ? 'Review market' : 'Create a market'}</Text>
    <Text style={s.body}>{review ? 'An approved reviewer must be assigned and the market funded before trading opens.' : 'Ask a campus question with a clear YES or NO outcome.'}</Text>
    {fields.map(([key, label, placeholder]) => <View key={key} style={{ gap: 7 }}>
      <Text style={s.label}>{label}</Text>
      {review ? <Text style={s.body}>{key.endsWith('At') ? dateLabel(String(parseDate(form[key]) / 1000)) : form[key]}</Text>
        : <TextInput accessibilityLabel={label} value={form[key]} maxLength={500} onChangeText={value => setForm(previous => ({ ...previous, [key]: value }))} placeholder={placeholder} placeholderTextColor={c.muted} style={s.input} />}
    </View>)}
    {(error || create.error || operation.data?.status === 'failed') && <Text style={s.error} accessibilityRole="alert">
      {error || create.error?.message || 'Publishing didn’t go through. Try again.'}
    </Text>}
    {pending && <Text style={s.muted}>Publishing your market…</Text>}
    {resultId ? <>
      <Text selectable style={s.body}>Market #{resultId} published · Awaiting funding</Text>
      <Button label="Open market" onPress={() => {
        router.push({ pathname: '/market/[id]', params: { id: resultId } });
        setRequest(undefined);
        setReview(false);
        setForm({ question: '', source: '', yesRule: '', noRule: '', closesAt: localDate(2), evidenceAt: localDate(4) });
      }} />
    </> : <>
      <Button label={review ? 'Publish market' : 'Review market'} disabled={create.isPending || pending || (review && account.data?.state !== 'ready')} onPress={submit} />
      {review && !pending && <Button label="Edit details" tone="quiet" onPress={() => setReview(false)} />}
    </>}
  </Page>;
}
