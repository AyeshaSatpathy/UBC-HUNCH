import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../api';
import { c, Icon, Loading, Page } from '../../ui';

export default function TabsLayout() {
  const { loading, signedIn } = useSession();
  const { bottom } = useSafeAreaInsets();
  if (loading) return <Page><Loading>Opening Hunch…</Loading></Page>;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Tabs screenOptions={{
    headerShown: false, tabBarActiveTintColor: c.lime, tabBarInactiveTintColor: c.cream,
    tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border, maxWidth: 520, width: '100%', alignSelf: 'center',
      height: 58 + bottom, paddingBottom: Math.max(6, bottom) },
    tabBarItemStyle: { minHeight: 44, minWidth: 44 },
    tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
  }}>
    <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: ({ focused }) => <Icon name="home-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarAccessibilityLabel: 'Explore Campus', tabBarIcon: ({ focused }) => <Icon name="compass-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="create" options={{ title: 'Create', tabBarIcon: ({ focused }) => <Icon name="add-circle-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: ({ focused }) => <Icon name="bar-chart-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <Icon name="person-outline" color={focused ? c.lime : c.cream} /> }} />
  </Tabs>;
}
