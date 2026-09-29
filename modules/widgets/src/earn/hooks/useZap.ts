import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAbi } from 'viem';
import { readContracts } from '@wagmi/core';
import { wagmiConfig } from '../../wallet/wallet';
import { YearnVault } from '../types';
import { DEPOSIT_COMMON_TOKENS, WITHDRAW_COMMON_TOKENS } from '../constants';
import { EnsoError, fetchEnsoConfigured, fetchWalletTokens, isNativeToken } from '../ensoApi';
import { ZapQuote, ZapRequest, quoteZap } from '../zapQuote';

export interface ZapToken {
  address: string;
  symbol: string;
  decimals: number;
  logo?: string;
  /** Wallet balance when known (deposit side). */
  balance?: bigint;
  /** The vault's own deposit asset — handled without Enso. */
  isAsset: boolean;
}

const TOKEN_META_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

export const tokenLogo = (chainId: number, address: string) =>
  `https://cdn.jsdelivr.net/gh/yearn/tokenassets@main/tokens/${chainId}/${address.toLowerCase()}/logo-128.png`;

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

async function readTokenMeta(chainId: number, addresses: string[]) {
  const results = await readContracts(wagmiConfig, {
    allowFailure: true,
    contracts: addresses.flatMap((address) => [
      { chainId, address: address as `0x${string}`, abi: TOKEN_META_ABI, functionName: 'symbol' },
      { chainId, address: address as `0x${string}`, abi: TOKEN_META_ABI, functionName: 'decimals' },
    ]) as any,
  });
  return addresses.map((address, index) => ({
    address,
    symbol: results[index * 2]?.status === 'success' ? String(results[index * 2].result) : '',
    decimals: results[index * 2 + 1]?.status === 'success' ? Number(results[index * 2 + 1].result) : 18,
  }));
}

/**
 * Tokens the widget offers. Deposits: the vault's asset first, then what the
 * wallet holds on the vault's chain, yearn.fi's common tokens first and the
 * rest by USD value. Withdrawals: the asset, then yearn.fi's common outputs.
 * Without Enso only the asset is offered.
 */
export function useZapTokens(vault: YearnVault, mode: 'deposit' | 'withdraw', walletAddress?: string) {
  const chainId = vault.chainID;
  const asset: ZapToken = {
    address: vault.token.address,
    symbol: vault.token.symbol,
    decimals: vault.token.decimals || 18,
    logo: vault.token.icon,
    isAsset: true,
  };

  const status = useQuery({ queryKey: ['enso-configured'], queryFn: fetchEnsoConfigured, staleTime: 10 * 60_000 });
  const enabled = status.data === true;

  const wallet = useQuery({
    queryKey: ['enso-wallet-tokens', walletAddress?.toLowerCase(), chainId],
    queryFn: () => fetchWalletTokens(walletAddress as string, chainId),
    enabled: enabled && mode === 'deposit' && Boolean(walletAddress),
    staleTime: 60_000,
  });

  const outputs = WITHDRAW_COMMON_TOKENS[chainId] || [];
  const outputMeta = useQuery({
    queryKey: ['token-meta', chainId, outputs.join(',')],
    queryFn: () => readTokenMeta(chainId, outputs),
    enabled: enabled && mode === 'withdraw' && outputs.length > 0,
    staleTime: 60 * 60_000,
  });

  const tokens = useMemo<ZapToken[]>(() => {
    if (!enabled) return [asset];
    const excluded = [vault.address, vault.staking?.address, vault.token.address].filter(Boolean) as string[];
    const isExcluded = (address: string) => excluded.some((item) => same(item, address));

    if (mode === 'withdraw') {
      const extra = (outputMeta.data || [])
        .filter((token) => token.symbol && !isExcluded(token.address))
        .map((token) => ({ ...token, logo: tokenLogo(chainId, token.address), isAsset: false }));
      return [asset, ...extra];
    }

    const common = (DEPOSIT_COMMON_TOKENS[chainId] || []).map((address) => address.toLowerCase());
    const rank = (address: string) => {
      const index = common.indexOf(address.toLowerCase());
      return index === -1 ? common.length : index;
    };
    const held = (wallet.data || [])
      .filter((token) => !isExcluded(token.address))
      .sort((a, b) => {
        const byRank = rank(a.address) - rank(b.address);
        if (byRank !== 0) return byRank;
        const usd = (token: typeof a) => (Number(token.balance) / 10 ** token.decimals) * token.price;
        return usd(b) - usd(a);
      })
      .map((token) => ({
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        balance: token.balance,
        logo: isNativeToken(token.address) ? token.logo : token.logo || tokenLogo(chainId, token.address),
        isAsset: false,
      }));
    return [asset, ...held];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, vault, wallet.data, outputMeta.data, chainId]);

  return { tokens, isEnsoEnabled: enabled };
}

const DEBOUNCE_MS = 500;
const REFRESH_MS = 30_000;

export interface ZapQuoteState {
  quote: ZapQuote | null;
  isQuoting: boolean;
  error: string | null;
}

/** Live protected quote for the widget's summary; `null` request clears it. */
export function useZapQuote(request: ZapRequest | null): ZapQuoteState {
  const [state, setState] = useState<ZapQuoteState>({ quote: null, isQuoting: false, error: null });
  const runRef = useRef(0);
  const key = request
    ? [
        request.chainId,
        request.from,
        request.tokenIn,
        request.tokenOut,
        request.amountIn.toString(),
        request.tolerancePct,
      ].join(':')
    : '';
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    const runId = ++runRef.current;
    if (!key) {
      setState({ quote: null, isQuoting: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, isQuoting: true, error: null }));

    const load = async () => {
      const current = requestRef.current;
      if (!current) return;
      try {
        const quote = await quoteZap(current);
        if (runRef.current === runId) setState({ quote, isQuoting: false, error: null });
      } catch (err) {
        if (runRef.current !== runId) return;
        const message = err instanceof EnsoError || err instanceof Error ? err.message : String(err);
        setState({ quote: null, isQuoting: false, error: message });
      }
    };

    const debounce = window.setTimeout(load, DEBOUNCE_MS);
    const refresh = window.setInterval(load, REFRESH_MS);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
    };
  }, [key]);

  return state;
}
