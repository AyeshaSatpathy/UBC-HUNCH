import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { publicApi as api } from './api';
import { Button, Icon, c, s } from './ui';

type SearchResult = Awaited<ReturnType<typeof api.campuses.search.query>>[number];
export type Campus = Pick<SearchResult, 'unitid' | 'name'>;

export function CampusSearch({ onSelect }: { onSelect: (campus: Campus) => void }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const term = input.trim();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const results = useQuery({
    queryKey: ['campuses', query],
    queryFn: ({ signal }) => api.campuses.search.query({ query }, { signal }),
    enabled: query.length >= 2 && query === term,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return <View style={{ gap: 8 }}>
    <View style={[s.row, s.input, { paddingVertical: 0 }]}>
      <Icon name="search-outline" size={18} color={c.muted} />
      <TextInput
        accessibilityLabel="Search campuses"
        placeholder="College or city"
        placeholderTextColor={c.muted}
        autoCorrect={false}
        maxLength={120}
        value={input}
        onChangeText={setInput}
        style={{ flex: 1, minHeight: 48, minWidth: 0, fontSize: 16, color: c.cream }}
      />
    </View>
    {term.length >= 2 && (query !== term || results.isPending) &&
      <Text accessibilityLiveRegion="polite" style={s.muted}>Searching…</Text>}
    {term.length >= 2 && query === term && results.isError && <>
      <Text accessibilityLiveRegion="polite" style={s.error}>Campus search is unavailable.</Text>
      <Button label="Try again" tone="quiet" onPress={() => void results.refetch()} />
    </>}
    {term.length >= 2 && query === term && results.isSuccess && (
      results.data.length ? results.data.map(({ unitid, name, city, state }) =>
        <Pressable
          key={unitid}
          accessibilityRole="button"
          onPress={() => { onSelect({ unitid, name }); setInput(''); }}
          style={({ pressed }) => ({ backgroundColor: pressed ? c.panel : c.bg, minHeight: 48,
            paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: c.border, gap: 2 })}
        >
          <Text style={s.body}>{name}</Text>
          <Text style={s.muted}>{city}, {state}</Text>
        </Pressable>
      ) : <Text accessibilityLiveRegion="polite" style={s.muted}>No campuses found.</Text>
    )}
  </View>;
}
