import { useNetworkState } from "expo-network";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import {
  AppState,
  Button,
  FlatList,
  Platform,
  Text,
  TextInput,
} from "react-native";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@hunch/api/router";
const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  `http://${Platform.OS === "android" ? "10.0.2.2" : "localhost"}:3000`;
export default function App() {
  const network = useNetworkState();
  useEffect(() => {
    onlineManager.setOnline(
      network.isInternetReachable ?? network.isConnected ?? true,
    );
  }, [network.isInternetReachable, network.isConnected]);
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${apiUrl}/trpc` })],
    }),
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => listener.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider queryClient={queryClient} trpcClient={client}>
          <Notes />
        </TRPCProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
function Notes() {
  const trpc = useTRPC();
  const cache = useQueryClient();
  const [text, setText] = useState("");
  const notes = useQuery(trpc.notes.list.queryOptions());
  const create = useMutation(
    trpc.notes.create.mutationOptions({
      onSuccess: async () => {
        setText("");
        await cache.invalidateQueries(trpc.notes.list.queryFilter());
      },
    }),
  );
  return (
    <SafeAreaView
      style={{ flex: 1, padding: 24, backgroundColor: "#f3f6f4", gap: 16 }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 28, fontWeight: "700" }}
      >
        Notes
      </Text>
      <TextInput
        accessibilityLabel="New note"
        placeholder="Write a note"
        value={text}
        onChangeText={setText}
        maxLength={500}
        editable={!create.isPending}
        style={{ backgroundColor: "white", padding: 16, borderRadius: 8 }}
      />
      <Button
        title={create.isPending ? "Saving�" : "Save note"}
        disabled={!text.trim() || create.isPending}
        onPress={() => create.mutate({ text })}
      />
      {create.error && (
        <Text accessibilityRole="alert">{create.error.message}</Text>
      )}
      {notes.isPending && <Text>Loading notes�</Text>}
      {notes.error && (
        <Text accessibilityRole="alert">{notes.error.message}</Text>
      )}
      <FlatList
        data={notes.data}
        keyExtractor={(note) => note.id}
        refreshing={notes.isFetching}
        onRefresh={() => void notes.refetch()}
        renderItem={({ item }) => (
          <Text style={{ paddingVertical: 16 }}>{item.text}</Text>
        )}
        ListEmptyComponent={
          !notes.isPending && !notes.error ? (
            <Text>Your saved notes will appear here.</Text>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
