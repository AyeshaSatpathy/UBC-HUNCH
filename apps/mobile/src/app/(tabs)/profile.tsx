import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useAccount, useCampus, usePortfolio, useSession } from '../../api';
import { Button, Icon, Note, Page, c, s } from '../../ui';

export default function Profile() {
  const { api, setSession } = useSession();
  const account = useAccount();
  const campus = useCampus(account.data?.campusId);
  const portfolio = usePortfolio();
  const signOut = useMutation({ mutationFn: async () => { await api.auth.signOut.mutate(); await setSession(null); } });
  const history = portfolio.data?.positions.filter(position => position.prediction) ?? [];
  const scored = history.filter(({ market }) => market.status === 'yes' || market.status === 'no');
  const correct = scored.filter(({ market, prediction }) => market.status.toUpperCase() === prediction).length;
  return <Page>
    <Text accessibilityRole="header" style={s.heading}>Reputation</Text>
    {campus.data && <View style={[s.panel, s.row]}><Icon name="location" color={c.lime} /><Text style={s.body}>{campus.data.name}</Text></View>}
    <View style={s.panel}>
      <Text style={s.label}>Prediction accuracy</Text>
      {scored.length ? <>
        <Text style={[s.heading, { color: c.lime, fontSize: 54 }]}>{Math.round(correct / scored.length * 100)}%</Text>
        <Text style={s.body}>{correct} of {scored.length} correct</Text>
      </> : <Text style={s.muted}>{portfolio.isPending ? 'Loading your predictions…' : 'Your accuracy will appear after a prediction settles.'}</Text>}
    </View>
    <Text style={s.label}>Prediction history</Text>
    {portfolio.isError ? <Button label="Retry history" tone="quiet" onPress={() => void portfolio.refetch()} /> :
      !portfolio.isPending && !history.length && <Note>No predictions yet.</Note>}
    {history.map(({ market, prediction }) => <View key={market.id} style={s.panel}>
      <Text style={s.label}>{market.question}</Text>
      <Text style={s.muted}>{prediction} · {market.status === 'void' ? 'Voided' :
        market.status === 'yes' || market.status === 'no' ? (prediction === market.status.toUpperCase() ? 'Correct' : 'Incorrect') : 'Pending'}</Text>
    </View>)}
    <Button label="Find a market" tone="quiet" onPress={() => router.navigate('/feed')} />
    <Button label="Sign out" tone="quiet" disabled={signOut.isPending} onPress={() => signOut.mutate()} />
    {signOut.error && <Text style={s.error}>{signOut.error.message}</Text>}
  </Page>;
}
