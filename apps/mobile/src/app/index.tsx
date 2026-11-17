import { Redirect } from 'expo-router';
import { useSession } from '../api';

export default function Index() {
  const { loading, signedIn } = useSession();
  if (loading) return null;
  return <Redirect href={signedIn ? '/feed' : '/onboarding'} />;
}
