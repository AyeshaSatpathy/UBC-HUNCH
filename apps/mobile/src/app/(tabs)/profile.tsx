import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useAccount, useCampus, usePortfolio, useSession } from '../../api';
import { Button, ErrorNotice, Icon, Loading, Note, Page, c, s } from '../../ui';

export default function Profile() {
  const { api } = useSession();
  const account = useAccount();
  const campus = useCampus(account.data?.campusId);
  const portfolio = usePortfolio();
  const history = portfolio.data?.positions.filter(position => position.prediction) ?? [];
  const scored = history.filter(({ market }) => market.status === 'yes' || market.status === 'no');
  const correct = scored.filter(({ market, prediction }) => market.status.toUpperCase() === prediction).length;
  const board = useQuery({ queryKey: ['leaderboard'], queryFn: ({ signal }) => api.leaderboard.query({}, { signal }), refetchInterval: 10_000 });
  return <Page tabbed>
    <View style={[s.row, s.between]}>
      <Text accessibilityRole="header" style={s.heading}>Profile</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={s.iconButton}>
        <Icon name="settings-outline" />
      </Pressable>
    </View>
    <View style={s.panel}>
      <View style={s.row}><View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.lilac, justifyContent: 'center', alignItems: 'center' }}><Text style={[s.label, { color: c.bg }]}>{account.data?.displayName?.slice(0, 1).toUpperCase() || 'H'}</Text></View>
        <View style={{ flex: 1 }}><Text style={s.label}>{account.data?.displayName || 'Your corner of campus'}</Text><Text style={s.muted}>A little instinct goes a long way.</Text></View>
      </View>
    </View>
    {campus.data && <View style={[s.panel, s.row]}><Icon name="location" color={c.lime} /><Text style={s.body}>{campus.data.name}</Text></View>}
    <View style={s.panel}>
      <Text style={s.label}>Prediction accuracy</Text>
      {scored.length ? <>
        <Text style={s.value}>{Math.round(correct / scored.length * 100)}%</Text>
        <Text style={s.body}>{correct} of {scored.length} correct</Text>
      </> : portfolio.isSuccess && <Text style={s.muted}>Your accuracy will appear after a prediction settles.</Text>}
    </View>
    <Text style={s.label}>Prediction history</Text>
    {portfolio.isError ? <ErrorNotice label="Retry history" retry={() => void portfolio.refetch()}>Couldn’t load your predictions.</ErrorNotice> :
      portfolio.isPending ? <Loading>Loading your predictions…</Loading> : !history.length && <Note>No predictions yet.</Note>}
    {history.map(({ market, prediction }) => <View key={market.id} style={s.panel}>
      <Text style={s.label}>{market.question}</Text>
      <Text style={s.muted}>{prediction} · {market.status === 'void' ? 'Voided' :
        market.status === 'yes' || market.status === 'no' ? (prediction === market.status.toUpperCase() ? 'Correct' : 'Incorrect') : 'Pending'}</Text>
    </View>)}
    <Button label="Find a market" tone="quiet" onPress={() => router.navigate('/feed')} />
    <Text style={s.label}>Campus leaderboard</Text>
    {board.isPending ? <Loading>Loading campus stats…</Loading> :
      board.isError ? <ErrorNotice retry={() => void board.refetch()}>Couldn’t load campus stats.</ErrorNotice> :
      !board.data.length ? <Note>Campus activity will appear here.</Note> :
      board.data.map(item => <View key={item.campusId} style={s.panel}>
        <Text style={s.label}>{item.campus}</Text>
        <Text style={s.body}>{item.purchases} purchases · {item.markets} markets · {item.participants} participants</Text>
      </View>)}
  </Page>;
}
