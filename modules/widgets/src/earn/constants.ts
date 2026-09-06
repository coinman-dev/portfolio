/** Shared constants for the Earn (Yearn) module. */

/** Render the Yearn wordmark in the top nav (owner decision: yes). */
export const SHOW_YEARN_BRAND = true;

export const YDAEMON_BASE_URL = 'https://ydaemon.yearn.fi';
export const KONG_BASE_URL = 'https://kong.yearn.fi';

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

