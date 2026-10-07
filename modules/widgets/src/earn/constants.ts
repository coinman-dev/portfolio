/** Shared constants for the Earn (Yearn) module. */

/** Render the Yearn wordmark in the top nav (owner decision: yes). */
export const SHOW_YEARN_BRAND = true;

export const YDAEMON_BASE_URL = 'https://ydaemon.yearn.fi';
export const KONG_BASE_URL = 'https://kong.yearn.fi';
/** yearn.fi's own portfolio-history API. It runs on a private indexer, so it
 *  cannot be hosted here; it is public and sends `Access-Control-Allow-Origin: *`. */
export const YEARN_HOLDINGS_API = 'https://yearn.fi/api/holdings';

/** yvUSD ships as two vaults that yearn.fi merges into a single entry. */
export const YVUSD_UNLOCKED_ADDRESS = '0x696d02Db93291651ED510704c9b286841d506987';
export const YVUSD_LOCKED_ADDRESS = '0xAaaFEa48472f77563961Cdb53291DEDfB46F9040';
/** Zap router used by the site for locked deposits (not executed yet, see plan §11.1). */
export const YVUSD_ZAP_ADDRESS = '0x7ba61c8e19414dcB8fe769a7Be63B508C8062bbA';
export const YVUSD_COOLDOWN_DAYS = 14;
export const YVUSD_WITHDRAW_WINDOW_DAYS = 5;

/**
 * Vaults whose icon yearn.fi serves itself instead of resolving through
 * smold.app — yvUSD has no entry in the token asset registry, so without this
 * it would fall back to the USDC logo of its deposit asset.
 */
export const VAULT_ICON_OVERRIDES: Record<string, string> = {
  [YVUSD_UNLOCKED_ADDRESS.toLowerCase()]: 'https://yearn.fi/yvusd-128.png',
  [YVUSD_LOCKED_ADDRESS.toLowerCase()]: 'https://yearn.fi/yvusd-128.png',
};

export const YBOLD_VAULT_ADDRESS = '0x9F4330700a36B29952869fac9b33f45EEdd8A3d8';
export const YBOLD_STAKING_ADDRESS = '0x23346B04a7f55b8760E5860AA5A77383D63491cD';
/**
 * yBOLD Zapper (source on Sourcify, `src/periphery/Zapper.sol`). `zapIn` takes
 * BOLD, deposits it into yBOLD and stakes the shares in st-yBOLD for the
 * receiver; `zapOut` redeems st-yBOLD and then yBOLD back to BOLD.
 */
export const YBOLD_ZAPPER_ADDRESS = '0xE7099092533A3FB693Bb123cD96B8e53b4d83C58';

/**
 * Loss a full withdrawal may accept, in basis points (0.01%). The vaults'
 * own default for `redeem` is 100%; yearn.fi relies on it, but a position of
 * this size should fail loudly rather than absorb an unrealized loss.
 */
export const MAX_LOSS_BPS = 1n;

/* ---------- Enso zaps ("any token" deposits and withdrawals) ---------- */

/** yearn.fi's own proxy to Enso's route API (it holds the API key; CORS `*`). */
export const YEARN_API = 'https://yearn.fi/api';
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** The only contracts an Enso route may send to (yearn.fi `ensoRouters.ts`). */
export const ENSO_ROUTERS: Record<number, string> = {
  1: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
  10: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
  137: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
  42161: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
  8453: '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf',
  747474: '0x3067BDBa0e6628497d527bEF511c22DA8b32cA3F',
};

/** Zap slippage, in percent: yearn.fi's default and presets; its hard cap is 5%. */
export const ZAP_SLIPPAGE_DEFAULT = 0.5;
export const ZAP_SLIPPAGE_PRESETS = [0.1, 0.5, 1];
/** Routes whose worst-case price impact reaches this are refused outright. */
export const ZAP_MAX_PRICE_IMPACT = 5;

/** Offered first in the deposit token picker (yearn.fi `DEPOSIT_COMMON_TOKENS_BY_CHAIN`). */
export const DEPOSIT_COMMON_TOKENS: Record<number, string[]> = {
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  10: [
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    '0x4200000000000000000000000000000000000006', // WETH
  ],
  137: [
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  ],
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  ],
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x4200000000000000000000000000000000000006', // WETH
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
    '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // cbBTC
  ],
  747474: [
    '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', // AUSD
    '0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36', // vbUSDC
    '0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62', // vbETH
    '0x62D6A123E8D19d06d68cf0d2294F9A3A0362c6b3', // vbUSDS
  ],
};

/** Offered as withdrawal outputs (yearn.fi `WITHDRAW_COMMON_TOKENS_BY_CHAIN`). */
export const WITHDRAW_COMMON_TOKENS: Record<number, string[]> = {
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0xdC035D45d973E3EC169d2276DDab16f1e407384F', // USDS
    '0x6440f144b7e50D6a8439336510312d2F54beB01D', // BOLD
    '0x9Cf12ccd6020b6888e4D4C4e4c7AcA33c1eB91f8', // USDaf
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  10: DEPOSIT_COMMON_TOKENS[10],
  137: DEPOSIT_COMMON_TOKENS[137],
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0x6491c05A82219b8D1479057361ff1654749b876b', // USDS
    '0x4ecf61a6c2FaB8A047CEB3B3B263B401763e9D49', // USND
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  ],
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', // USDS
    '0x4200000000000000000000000000000000000006', // WETH
    '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // cbBTC
  ],
  747474: DEPOSIT_COMMON_TOKENS[747474],
};

/** Native gas tokens are priced through their wrapped version. */
export const WRAPPED_NATIVE: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  10: '0x4200000000000000000000000000000000000006',
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  8453: '0x4200000000000000000000000000000000000006',
  747474: '0xEE7D8BCFb72bC1880D0Cf19822eB0A2e6577aB62',
};

/** Chain names used as keys by yearn.fi's spot price endpoint. */
export const PRICE_CHAIN_SLUGS: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  747474: 'katana',
};

/* ---------- Migration of retired vaults ---------- */

/** Yearn 4626 Router: `migrateFromV2` / `migrate` for everything outside the registry. */
export const YEARN_4626_ROUTER = '0x1112dbCF805682e828606f74AB717abf4b4FD8DE';
/**
 * Migrators yearn.fi knows (`migratorRegistry.ts`). Kong names the contract to
 * use; anything not listed here goes through the router, as on the site.
 */
export const VAULT_MIGRATORS: Record<string, 'vault-migrator' | 'vecrv-zap'> = {
  '0x9327e2fdc57c7d70782f29ab46f6385afaf4503c': 'vault-migrator',
  '0x1824df8d751704fa10fa371d62a37f9b8772ab90': 'vault-migrator',
  '0xdc899ab992fbcfbac936ce5a5bc5a86a5d35a66a': 'vecrv-zap',
};
/** Minimum-out tolerance for migrations, from a simulation of the same call. */
export const MIGRATION_SLIPPAGE_BPS = 50n;

export const LINKS = {
  userDocs: 'https://docs.yearn.fi/getting-started/products/yvaults/overview',
  devDocs: 'https://docs.yearn.fi/developers/v3/overview',
  powerglove: (chainId: number, address: string) =>
    `https://powerglove.yearn.fi/vaults/${chainId}/${address}`,
  ydaemonVault: (chainId: number, address: string) =>
    `${YDAEMON_BASE_URL}/${chainId}/vaults/${address}`,
  kongSnapshot: (chainId: number, address: string) =>
    `${KONG_BASE_URL}/api/rest/snapshot/${chainId}/${address}`,
};

