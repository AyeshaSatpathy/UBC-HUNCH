import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useSession } from './api';
import { Button, ErrorNotice, Loading, Note, c, s } from './ui';

export type GeminiChoice = Awaited<ReturnType<ReturnType<typeof useSession>['api']['gemini']['search']['query']>>[number];

export function GeminiSearch({ onSelect }: { onSelect: (item: GeminiChoice) => void }) {
  const { api } = useSession();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const result = useQuery({ queryKey: ['gemini-search', query], enabled: query.length >= 2,
    queryFn: ({ signal }) => api.gemini.search.query({ query }, { signal }), retry: false });
  return <View style={s.panel}>
    <Text style={s.label}>Link a Gemini market</Text>
    <Text style={s.muted}>Optional. Choose an event to use Gemini�s published question and rules.</Text>
    <TextInput accessibilityLabel="Search Gemini markets" placeholder="Search events" placeholderTextColor={c.muted}
      style={s.input} value={input} onChangeText={setInput} maxLength={120} />
    <Button label="Search Gemini" disabled={input.trim().length < 2 || result.isFetching}
      tone="quiet" onPress={() => { setQuery(input.trim()); if (query === input.trim()) void result.refetch(); }} />
    {!!query && (result.isPending ? <Loading>Searching Gemini…</Loading> :
      result.isError ? <ErrorNotice retry={() => void result.refetch()}>Gemini search is unavailable.</ErrorNotice> :
      !result.data.length ? <Note>No matching active contracts.</Note> :
      result.data.map(item => <Button key={item.contractId} label={item.question} tone="quiet" onPress={() => onSelect(item)} />))}
  </View>;
}

export function GeminiOdds({ marketId, crowd }: { marketId: string; crowd: number }) {
  const { api } = useSession();
  const result = useQuery({ queryKey: ['gemini-market', marketId],
    queryFn: ({ signal }) => api.gemini.market.query({ marketId }, { signal }), refetchInterval: 30_000, retry: false });
  if (result.isPending) return <Loading>Checking Gemini odds…</Loading>;
  if (result.isError) return <ErrorNotice retry={() => void result.refetch()}>Gemini odds are unavailable.</ErrorNotice>;
  if (!result.data) return null;
  const data = result.data;
  const points = data.history.slice(-40);
  return <View style={s.panel}>
    <Text style={s.label}>Gemini and campus odds</Text>
    <Text style={s.body}>Campus YES {crowd}% · Gemini YES {data.yesPercent == null ? 'unavailable' : data.yesPercent + '%'}</Text>
    {data.outcome && <Text style={s.body}>Gemini settled {data.outcome}</Text>}
    <Text style={s.label}>Gemini odds over time</Text>
    {points.length < 2 ? <Note>History is building as Gemini prices arrive.</Note> : <>
      <View accessibilityRole="image" accessibilityLabel={'Gemini YES odds from ' + points[0].yes + '% to ' + points.at(-1)!.yes + '%'}
        style={{ height: 110, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {points.map(point => <View key={point.at} style={{ flex: 1, height: Math.max(2, point.yes) + '%', backgroundColor: c.lilac, borderRadius: 2 }} />)}
      </View>
      <Text style={s.muted}>{new Date(points[0].at).toLocaleString()} – {new Date(points.at(-1)!.at).toLocaleString()}</Text>
    </>}
  </View>;
}
