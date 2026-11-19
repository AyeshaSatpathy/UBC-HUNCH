import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSession } from './api';
import { Button, ErrorNotice, Icon, Loading, Note, c, s } from './ui';

export type GeminiChoice = Awaited<ReturnType<ReturnType<typeof useSession>['api']['gemini']['search']['query']>>[number];

export function GeminiSearch({ onSelect }: { onSelect: (item: GeminiChoice) => void }) {
  const { api } = useSession();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const result = useQuery({ queryKey: ['gemini-search', query], enabled: query.length >= 2,
    queryFn: ({ signal }) => api.gemini.search.query({ query }, { signal }), retry: false });
  return <View style={s.panel}>
    <View style={[s.row, s.between]}><Text style={s.label}>Find an event</Text><Text style={s.eyebrow}>GEMINI</Text></View>
    <Text style={s.muted}>Use a published question and its rules, or write your own below.</Text>
    <View style={s.row}>
    <TextInput accessibilityLabel="Search Gemini markets" placeholder="Search events" placeholderTextColor={c.muted}
      style={[s.input, { flex: 1, minWidth: 0 }]} value={input} onChangeText={setInput} maxLength={120} returnKeyType="search" onSubmitEditing={() => { if (input.trim().length >= 2) setQuery(input.trim()); }} />
    <Button label="Search" disabled={input.trim().length < 2 || result.isFetching}
      tone="quiet" onPress={() => { setQuery(input.trim()); if (query === input.trim()) void result.refetch(); }} />
    </View>
    {!!query && (result.isPending ? <Loading>Searching Gemini…</Loading> :
      result.isError ? <ErrorNotice retry={() => void result.refetch()}>Gemini search is unavailable.</ErrorNotice> :
      !result.data.length ? <Note>No matching active contracts.</Note> :
      <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
        {result.data.map(item => <Pressable key={item.contractId} accessibilityRole="button" accessibilityLabel={item.question}
          onPress={() => onSelect(item)} style={({ pressed }) => [s.row, { minHeight: 56, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[s.body, { flex: 1 }]}>{item.question}</Text><Icon name="add-circle-outline" color={c.lime} />
        </Pressable>)}
      </ScrollView>)}
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
