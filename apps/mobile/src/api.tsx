import type { AppRouter } from '@hunch/api/router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

const defaultHost = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const endpoint = (process.env.EXPO_PUBLIC_API_URL || defaultHost).replace(/\/+$/, '') + '/trpc';
const key = 'hunch.session';
function makeApi(token?: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: endpoint, headers: () => token ? { Authorization: 'Bearer ' + token } : {} })],
  });
}

export const publicApi = makeApi();
type Api = typeof publicApi;
export type Market = Awaited<ReturnType<Api['markets']['list']['query']>>['items'][number];
export type Position = Awaited<ReturnType<Api['portfolio']['get']['query']>>['positions'][number];
export type Action = Awaited<ReturnType<Api['actions']['pending']['query']>>[number];
export type Side = 'YES' | 'NO';

const Context = createContext<{ api: Api; loading: boolean; signedIn: boolean; setSession: (token: string | null) => Promise<void> } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>();
  const queryClient = useQueryClient();
  useEffect(() => {
    const read = async () => Platform.OS === 'web'
      ? globalThis.sessionStorage?.getItem(key) ?? null
      : SecureStore.getItemAsync(key);
    void read().then(setToken, () => setToken(null));
  }, []);
  const api = useMemo(() => token ? makeApi(token) : publicApi, [token]);
  const setSession = useCallback(async (next: string | null) => {
    if (Platform.OS === 'web') {
      if (next) globalThis.sessionStorage?.setItem(key, next);
      else globalThis.sessionStorage?.removeItem(key);
    } else if (next) await SecureStore.setItemAsync(key, next);
    else await SecureStore.deleteItemAsync(key);
    await queryClient.cancelQueries();
    queryClient.clear();
    setToken(next);
  }, [queryClient]);
  return <Context.Provider value={{
    api, loading: token === undefined, signedIn: !!token, setSession,
  }}>{children}</Context.Provider>;
}

export function useSession() {
  const context = useContext(Context);
  if (!context) throw new Error('SessionProvider is missing');
  return context;
}

export function useAccount() {
  const { api, signedIn, setSession } = useSession();
  const result = useQuery({
    queryKey: ['account'], queryFn: ({ signal }) => api.auth.me.query(undefined, { signal }),
    enabled: signedIn, retry: false, staleTime: 10_000,
    refetchInterval: ({ state }) => state.data?.state === 'pending' ? 4_000 : false,
  });
  useEffect(() => {
    if (result.error instanceof TRPCClientError && result.error.data?.code === 'UNAUTHORIZED') void setSession(null);
  }, [result.error, setSession]);
  return result;
}

export function useCampus(id?: number) {
  return useQuery({
    queryKey: ['campus', id], enabled: !!id, staleTime: 300_000,
    queryFn: async ({ signal }) => (await publicApi.campuses.search.query({ query: String(id) }, { signal }))[0],
  });
}

export function usePortfolio() {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['portfolio'], queryFn: ({ signal }) => api.portfolio.get.query(undefined, { signal }),
    enabled: signedIn, refetchInterval: 8_000, retry: false,
  });
}

export function useAction(id?: string | null) {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['action', id], enabled: signedIn && !!id,
    queryFn: () => api.actions.advance.mutate({ id: id! }),
    refetchInterval: ({ state }) => state.data?.status === 'confirmed' || state.data?.status === 'failed' ? false : 2_000,
    retry: false,
  });
}

export const actionKey = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
export const isOpen = (market: Market) => market.status === 'open' && Number(market.closesAtUnix) * 1_000 > Date.now();
export const isSettled = (market: Market) => market.status === 'yes' || market.status === 'no' || market.status === 'void';
export const statusLabel = (market: Market) => ({ draft: 'Awaiting funding', open: 'Open', awaiting: 'Awaiting result', yes: 'YES won', no: 'NO won', void: 'Voided' })[market.status];
export function money(cents: string | number) {
  const amount = BigInt(cents);
  return '$' + (amount / 100n).toLocaleString('en-US') + '.' + String(amount % 100n).padStart(2, '0');
}
export function shares(units: string) {
  const amount = BigInt(units);
  return (amount / 1_000_000n).toLocaleString('en-US') + '.' + String(amount % 1_000_000n).padStart(6, '0').slice(0, 2);
}
export const dateLabel = (seconds: string) => new Date(Number(seconds) * 1_000).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
