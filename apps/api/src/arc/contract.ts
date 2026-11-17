import { createPublicClient, defineChain, http, parseAbi } from "viem";

export const chainId = 5042002;
export const market = "0x73dd30b231f405c1dcf0812c64ddcc5f02143d20";
export const usdc = "0x3600000000000000000000000000000000000000";
export const deploymentBlock = 0x44fc7b4n;
export const rpc = "https://rpc.testnet.arc.io";
export const arcTestnet = defineChain({
  id: chainId, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } }, testnet: true,
});
export const arcTransport = () => http(process.env.ARC_TESTNET_RPC_URL || rpc);

export const marketAbi = parseAbi([
  "struct Terms { string question; string source; string yesRule; string noRule; uint256 close; uint256 deadline; }",
  "struct Market { Terms terms; uint256 campus; address creator; address reviewer; uint8 status; uint256 allocation; uint256 sets; uint256 yesReserve; uint256 noReserve; uint256 fees; uint256 remainingClaims; bytes32 evidence; }",
  "function getMarket(uint256 id) view returns (Market)",
  "function quote(uint256 id, bool yes, uint256 principal) view returns (uint256 shares, uint256 fee, uint256 debit)",
  "function claim(uint256 id) returns (uint256 amount)",
  "function admin() view returns (address)",
  "function liquidityProvider() view returns (address)",
  "function available() view returns (uint256)",
  "function ALLOCATION_CAP() view returns (uint256)",
  "function fund(uint256 id, uint256 allocation)",
  "function reviewerRoster(address reviewer) view returns (bool)",
  "function resolve(uint256 id, bool yes, bytes32 evidence)",
  "function campusOf(address wallet) view returns (uint256)",
  "function register(address wallet, uint256 campus)",
  "function create(Terms terms) returns (uint256 id)",
  "function buy(uint256 id, bool yes, uint256 principal, uint256 minShares) returns (uint256)",
  "function predict(uint256 id, bool yes)",
  "function positions(uint256 id, address wallet) view returns (uint256 yes, uint256 no, uint256 debit, uint8 prediction, bool claimed)",
  "error UnknownMarket()",
  "error TradingClosed()",
  "error MarketNotOpen()",
  "error InvalidPrincipal()",
  "error AlreadyClaimed()",
  "error NothingToClaim()",
  "error MarketNotFinalized()",
  "event CampusRegistered(address indexed wallet, uint256 campus)",
  "event ReviewerRosterUpdated(address indexed wallet, bool approved)",
  "event MarketCreated(uint256 indexed id, uint256 indexed campus, address indexed creator)",
  "event ReviewerAssigned(uint256 indexed id, address indexed reviewer)",
  "event VaultDeposited(uint256 amount)",
  "event VaultWithdrawn(uint256 amount)",
  "event MarketFunded(uint256 indexed id, uint256 allocation)",
  "event Purchased(uint256 indexed id, address indexed buyer, bool yes, uint256 principal, uint256 fee, uint256 shares)",
  "event Predicted(uint256 indexed id, address indexed student, bool yes)",
  "event Finalized(uint256 indexed id, uint8 status, bytes32 evidence, uint256 capitalReturned, uint256 feesReturned)",
  "event Claimed(uint256 indexed id, address indexed wallet, uint256 amount)",
]);

export const collateralAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const createArcClient = () => createPublicClient({
  chain: arcTestnet, transport: arcTransport(),
});
