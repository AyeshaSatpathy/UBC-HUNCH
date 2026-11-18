import { Redirect } from 'expo-router';
import { useSession } from '../api';
import { Loading, Page } from '../ui';

export default function Index() {
  const { loading, signedIn } = useSession();
  if (loading) return <Page><Loading>Opening Hunch…</Loading></Page>;
  return <Redirect href={signedIn ? '/feed' : '/onboarding'} />;
}
