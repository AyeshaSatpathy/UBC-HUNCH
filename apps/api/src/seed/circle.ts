import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createHash } from 'node:crypto';

export const market = '0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20';
export const usdc = '0x3600000000000000000000000000000000000000';
export const rpc = 'https://rpc.testnet.arc.io';
export const blockchain = 'ARC-TESTNET';

function required(name: 'CIRCLE_API_KEY' | 'CIRCLE_ENTITY_SECRET') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is missing from apps/api/.env');
  return value;
}

const apiKey = required('CIRCLE_API_KEY');
if (!apiKey.startsWith('TEST_API_KEY:')) throw new Error('Use a Circle testnet API key.');
const entitySecret = required('CIRCLE_ENTITY_SECRET');
if (!/^[0-9a-f]{64}$/i.test(entitySecret)) throw new Error('Invalid entity secret format.');

export const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

export async function findCircleTransaction(walletId: string, refId: string, notBefore: Date) {
  let pageAfter: string | undefined;
  for (;;) {
    const response = await circle.listTransactions({ walletIds: [walletId], pageAfter, pageSize: 50 });
    const rows = response.data?.transactions ?? [];
    const match = rows.find((row) => row.refId === refId);
    if (match) return match;
    for (const row of rows) {
      if (row.refId || new Date(row.createDate) < notBefore) continue;
      // Circle omits refId from transaction summaries for some smart account operations.
      const detail = (await circle.getTransaction({ id: row.id })).data?.transaction;
      if (detail?.refId === refId) return detail;
    }
    if (rows.length < 50) return undefined;
    const next = rows.at(-1)?.id;
    if (!next || next === pageAfter) throw new Error("Circle transaction pagination did not advance");
    pageAfter = next;
  }
}

// UUIDv4 format with a stable digest so rerunning does not duplicate requests.
export function requestId(label: string) {
  const value = createHash('sha256').update('hunch-arc-seed-v1:' + market + ':' + label).digest('hex');
  return [value.slice(0, 8), value.slice(8, 12), '4' + value.slice(13, 16), '8' + value.slice(17, 20), value.slice(20, 32)].join('-');
}

export async function walletPair(accountType: 'SCA' | 'EOA') {
  const set = await circle.createWalletSet({
    idempotencyKey: requestId('set'),
    name: 'Hunch Arc testnet seed',
  });
  const walletSetId = set.data?.walletSet.id;
  if (!walletSetId) throw new Error('Circle did not return a wallet set ID.');
  const response = await circle.createWallets({
    idempotencyKey: requestId('wallets:' + accountType),
    walletSetId,
    blockchains: [blockchain],
    accountType,
    count: 2,
    metadata: [{ name: 'Hunch seed buyer' }, { name: 'Hunch seed reviewer' }],
  });
  const wallets = response.data?.wallets;
  if (!wallets || wallets.length !== 2 || wallets.some(w => w.blockchain !== blockchain || w.accountType !== accountType)) {
    throw new Error('Circle did not return the requested Arc testnet wallets.');
  }
  return { walletSetId, buyer: wallets[0]!, reviewer: wallets[1]! };
}

export function reportFailure(error: unknown) {
  // SDK errors can contain HTTP request configuration, including credentials.
  const response = (error as { response?: { status?: number; data?: { code?: number } } })?.response;
  if (response) console.error('Circle request failed', { status: response.status, code: response.data?.code });
  else console.error(error instanceof Error && !('config' in error) ? error.message : 'Circle request failed');
  process.exitCode = 1;
}
