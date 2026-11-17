param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[1-9][0-9]*$')]
    [string]$MarketId,

    [ValidateRange(1, 2000)]
    [int]$AllocationCents = 2000,

    [string]$Account = 'arc-lp',

    [string]$RpcUrl = 'https://rpc.testnet.arc.io',

    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
$workspaceCast = Join-Path $PSScriptRoot '../../../.tools/foundry/cast.exe'
$cast = if (Test-Path -LiteralPath $workspaceCast) { $workspaceCast } else { 'cast' }
$contract = '0x73Dd30B231f405C1DCf0812c64dDCc5F02143D20'
$allocation = $AllocationCents * 10000
$network = & $cast chain-id --rpc-url $RpcUrl
if ($LASTEXITCODE -ne 0 -or $network -ne '5042002') { throw 'Expected Arc testnet.' }
$lp = & $cast call $contract 'liquidityProvider()(address)' --rpc-url $RpcUrl
if ($LASTEXITCODE -ne 0 -or $lp -notmatch '^0x[0-9a-fA-F]{40}$') { throw 'Could not read the contract LP.' }

& $cast call $contract 'fund(uint256,uint256)' $MarketId $allocation --from $lp --rpc-url $RpcUrl
if ($LASTEXITCODE -ne 0) { throw 'Funding preflight failed. Check reviewer approval, trading close, allocation, and available vault funds.' }
if ($PreflightOnly) { return }
& $cast send $contract 'fund(uint256,uint256)' $MarketId $allocation --account $Account --rpc-url $RpcUrl
if ($LASTEXITCODE -ne 0) { throw 'Funding transaction failed.' }
