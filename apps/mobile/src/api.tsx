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

const Context = createContext<{ api: Api; loading: boolean; signedIn: boolean; showIntro: boolean; finishIntro: () => void; setSession: (token: string | null) => Promise<void> } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [showIntro, setShowIntro] = useState(false);
  const finishIntro = useCallback(() => setShowIntro(false), []);
  const [token, setToken] = useState<string | null>();
  const queryClient = useQueryClient();
  useEffect(() => {
    const read = async () => {
      if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
      const saved = globalThis.localStorage?.getItem(key) ?? globalThis.sessionStorage?.getItem(key) ?? null;
      if (saved) globalThis.localStorage?.setItem(key, saved);
      globalThis.sessionStorage?.removeItem(key);
      return saved;
    };
    void read().then(setToken, () => setToken(null));
  }, []);
  const api = useMemo(() => token ? makeApi(token) : publicApi, [token]);
  const setSession = useCallback(async (next: string | null) => {
    if (Platform.OS === 'web') {
      if (next) globalThis.localStorage?.setItem(key, next);
      else globalThis.localStorage?.removeItem(key);
      globalThis.sessionStorage?.removeItem(key);
    } else if (next) await SecureStore.setItemAsync(key, next);
    else await SecureStore.deleteItemAsync(key);
    await queryClient.cancelQueries();
    queryClient.clear();
    setShowIntro(!!next);
    setToken(next);
  }, [queryClient]);
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const error = event.query.state.error;
    if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') void setSession(null);
  }), [queryClient, setSession]);
  useEffect(() => queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const error = event.mutation.state.error;
    if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') void setSession(null);
  }), [queryClient, setSession]);
  return <Context.Provider value={{
    api, loading: token === undefined, signedIn: !!token, setSession, showIntro, finishIntro,
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

export function useSavedMarkets() {
  const { api, signedIn } = useSession();
  return useQuery({ queryKey: ['saved-markets'], queryFn: ({ signal }) => api.markets.saved.query(undefined, { signal }), enabled: signedIn });
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
export function studentError(error: unknown, fallback: string) {
  if (!(error instanceof TRPCClientError)) return fallback;
  if (error.data?.code === 'TOO_MANY_REQUESTS') return error.message.startsWith('Too many sign-in') ? 'Too many attempts. Try again in 15 minutes.' : 'Please wait a minute before requesting another code.';
  if (error.data?.code === 'UNAUTHORIZED') return 'Please sign in again.';
  const messages: Record<string, string> = {
    'Complete Sign up first to create your password.': 'Use Sign up to create your password first.',
    'Complete sign up and choose a password to continue.': 'Use Sign up to create your password first.',
    'You already have an account. Use Log in or Reset password.': 'You already have an account. Use Log in or Reset password.',

    'Email or password is incorrect. You can also sign in with an email code.': 'Email or password is incorrect. Try again or use an email code.',
    'This school email domain is not supported': 'This school email domain is not supported.',
    'This email does not match the selected campus.': 'This email does not match the selected campus.',
    'The code could not be sent. Please retry later': 'Email is temporarily unavailable. Please try again shortly.',
    'Email verification is unavailable': 'Email sign-in is temporarily unavailable. Please try again shortly.',
    'Your account is still being set up.': 'We are getting your account ready. You can keep browsing while you wait.',
    'The code is invalid or expired': 'The code is invalid or expired.',
    'The price changed. Review the new quote before confirming.': 'The price changed. Review the new quote before confirming.',
    'Insufficient balance.': 'Insufficient balance.',
    'You already have an action processing. Check Portfolio to resume.': 'You already have an action processing. Check Portfolio to resume.',
    'You already made a prediction.': 'You already made a prediction.',
  };
  return Object.hasOwn(messages, error.message) ? messages[error.message] : fallback;
}
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
