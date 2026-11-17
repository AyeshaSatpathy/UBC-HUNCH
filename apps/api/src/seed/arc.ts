import { blockchain, circle, market, reportFailure, requestId, rpc, usdc, walletPair } from './circle';

const principal = '4000000';
const debit = '4040000';
const shares = '7333333';
const entryPoint = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const operationEvent = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
const evidence = '0x' + Buffer.from('Hunch synthetic YES seed').toString('hex').padEnd(64, '0');
const cast = process.env.ARC_CAST ?? new URL('../../../../.tools/foundry/cast.exe', import.meta.url);

function castRead(...args: string[]) {
  const result = Bun.spawnSync([typeof cast === 'string' ? cast : Bun.fileURLToPath(cast), ...args, '--rpc-url', rpc]);
  if (result.exitCode !== 0) throw new Error('Arc read failed: ' + args[0] + ' ' + (args[2] ?? ''));
  return result.stdout.toString().trim();
}

function balance(address: string) {
  return BigInt(castRead('call', usdc, 'balanceOf(address)(uint256)', address).split(' ')[0]!);
}

function positionOf(id: string, address: string) {
  return castRead('call', market, 'positions(uint256,address)(uint256,uint256,uint256,uint8,bool)', id, address)
    .split(/\r?\n/).map(line => line.trim().split(' ')[0]);
}

async function execute(wallet: { id: string; address: string }, target: string, signature: string, args: string[], label: string) {
  const callData = Bun.spawnSync([
    typeof cast === 'string' ? cast : Bun.fileURLToPath(cast), 'calldata', signature, ...args,
  ]);
  const data = callData.stdout.toString().trim();
  if (callData.exitCode !== 0 || !/^0x[0-9a-f]+$/i.test(data)) throw new Error('Unable to encode ' + signature);
  const result = await circle.createContractExecutionTransaction({
    walletId: wallet.id,
    contractAddress: target,
    ...(label === 'approve-zero'
      ? { abiFunctionSignature: signature, abiParameters: args }
      : { callData: data as `0x${string}` }),
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: requestId(wallet.id + ':' + label),
  });
  const id = result.data?.id;
  if (!id) throw new Error('Circle did not return a transaction ID.');
  console.log('Circle transaction:', id);
  for (let attempt = 0; attempt < 20; attempt++) {
    const tx = (await circle.getTransaction({ id })).data?.transaction;
    if (!tx) throw new Error('Circle did not return the transaction.');
    if (tx.state === 'COMPLETE' && tx.txHash) {
      const receipt = JSON.parse(castRead('receipt', tx.txHash, '--json')) as {
        status: string; logs: { address: string; topics: string[]; data: string }[];
      };
      if (receipt.status !== '0x1') throw new Error('The Arc receipt did not succeed.');
      const operation = receipt.logs.find(log => log.address.toLowerCase() === entryPoint &&
        log.topics[0] === operationEvent && log.topics[2]?.slice(-40) === wallet.address.slice(2).toLowerCase());
      const sponsored = !!operation?.topics[3] && BigInt(operation.topics[3]) !== 0n;
      if (operation && BigInt('0x' + operation.data.slice(66, 130)) !== 1n) {
        throw new Error('The smart account operation reverted.');
      }
      console.log(JSON.stringify({ txHash: tx.txHash, sponsored }));
      return { hash: tx.txHash, logs: receipt.logs };
    }
    if (tx.state === 'FAILED' || tx.state === 'DENIED' || tx.state === 'CANCELLED') {
      throw new Error(label + ' ended with state ' + tx.state);
    }
    await Bun.sleep(1500);
  }
  throw new Error('Transaction still pending. Rerun the same command to check it.');
}

async function main() {
  const [step = 'provision', mode = 'SCA', input] = process.argv.slice(2);
  if (!['provision', 'probe', 'faucet', 'create', 'buy', 'resolve', 'claim'].includes(step) ||
    (mode !== 'SCA' && mode !== 'EOA')) {
    throw new Error('Usage: bun run seed:arc <provision|probe|faucet|create|buy|resolve|claim> <SCA|EOA> [close timestamp or market ID]');
  }
  if (step === 'probe' && mode !== 'SCA') throw new Error('The sponsorship probe requires an SCA.');
  const type = mode;
  const { walletSetId, buyer, reviewer } = await walletPair(type);
  if (step === 'faucet') {
    const response = await circle.requestTestnetTokens({ blockchain, address: buyer.address, usdc: true });
    console.log('Faucet response:', response.status, 'buyer:', buyer.address);
    return;
  }
  if (step === 'provision') {
    console.log(JSON.stringify({
      walletSetId,
      blockchain,
      type,
      buyer: { id: buyer.id, address: buyer.address },
      reviewer: { id: reviewer.id, address: reviewer.address },
    }, null, 2));
    return;
  }

  if (step === 'probe') {
    await execute(buyer, usdc, 'approve(address,uint256)', [market, '0'], 'approve-zero');
    return;
  }

  if (!input || !/^[1-9][0-9]*$/.test(input)) throw new Error('Pass a close timestamp for create or a market ID for other steps.');
  if (step === 'create') {
    const deadline = (BigInt(input) + 86_400n).toString();
    const terms = `("Hunch synthetic testnet seed: will the fixture be YES?","Operator fixture","Fixture is YES","Fixture is NO",${input},${deadline})`;
    const result = await execute(buyer, market, 'create((string,string,string,string,uint256,uint256))', [terms], 'create:' + input);
    const topic = Bun.spawnSync([typeof cast === 'string' ? cast : Bun.fileURLToPath(cast), 'keccak', 'MarketCreated(uint256,uint256,address)']).stdout.toString().trim();
    const event = result.logs.find(log => log.address.toLowerCase() === market.toLowerCase() && log.topics[0] === topic);
    if (!event?.topics[1]) throw new Error('The market creation event was missing.');
    console.log('Market ID:', BigInt(event.topics[1]).toString());
    return;
  }
  if (step === 'buy') {
    if (positionOf(input, buyer.address)[2] === '0') {
      const quote = castRead('call', market, 'quote(uint256,bool,uint256)(uint256,uint256,uint256)', input, 'true', principal);
      const values = quote.split(/\r?\n/).map(line => line.trim().split(' ')[0]);
      if (values.join(',') !== [shares, '40000', debit].join(',')) throw new Error('The market does not have the expected initial quote.');
      if (balance(buyer.address) < BigInt(debit)) throw new Error('Fund the buyer with at least 4.04 test USDC.');
      await execute(buyer, usdc, 'approve(address,uint256)', [market, debit], 'approve:' + input);
    }
    await execute(buyer, market, 'buy(uint256,bool,uint256,uint256)', [input, 'true', principal, shares], 'buy:' + input);
    const [yes, no, paid] = positionOf(input, buyer.address);
    if (yes !== shares || no !== '0' || paid !== debit) throw new Error('The recorded position differs from the seed quote.');
    console.log('Position verified:', { yes, paid });
    return;
  }
  if (step === 'resolve') {
    await execute(reviewer, market, 'resolve(uint256,bool,bytes32)', [input, 'true', evidence], 'resolve:' + input);
    return;
  }
  await execute(buyer, market, 'claim(uint256)', [input], 'claim:' + input);
  if (positionOf(input, buyer.address)[4] !== 'true') throw new Error('The position is not marked claimed.');
  console.log('Buyer balance in asset units:', balance(buyer.address).toString());
}

await main().catch(reportFailure);
