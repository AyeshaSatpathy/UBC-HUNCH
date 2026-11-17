import { Redirect, router, Tabs } from 'expo-router';
import { Pressable } from 'react-native';
import { useSession } from '../../api';
import { c, Icon } from '../../ui';

export default function TabsLayout() {
  const { loading, signedIn } = useSession();
  if (loading) return null;
  if (!signedIn) return <Redirect href="/onboarding" />;
  return <Tabs screenOptions={{
    headerShown: false, tabBarActiveTintColor: c.lime, tabBarInactiveTintColor: c.cream,
    tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border, maxWidth: 520, width: '100%', alignSelf: 'center' },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
  }}>
    <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: ({ focused }) => <Icon name="home-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="create" options={{ title: 'Create', tabBarIcon: ({ focused }) => <Icon name="add-circle-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="mic" options={{ title: 'Voice',
      tabBarIcon: () => <Icon name="mic" color={c.bg} />,
      tabBarButton: ({ children, style }) => <Pressable accessibilityRole="button" accessibilityLabel="Voice" onPress={() => router.push('/voice')} style={[style, { backgroundColor: c.lime, borderRadius: 22, marginHorizontal: 4 }]}>{children}</Pressable>,
      tabBarLabelStyle: { color: c.bg, fontSize: 10, fontWeight: '800' },
    }} />
    <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: ({ focused }) => <Icon name="bar-chart-outline" color={focused ? c.lime : c.cream} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <Icon name="person-outline" color={focused ? c.lime : c.cream} /> }} />
  </Tabs>;
}
