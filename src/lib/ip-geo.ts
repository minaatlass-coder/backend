/**
 * Classification IP : Maroc uniquement, hors proxy/VPN/datacenter (ip-api.com).
 * Cache mémoire pour limiter les appels externes.
 */

export interface IpGeoResult {
  countryCode: string | null;
  isProxy: boolean;
  isHosting: boolean;
  /** Trafic comptabilisable dans le dashboard (MA + pas proxy + pas hosting) */
  isValidMa: boolean;
  lookupOk: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 8_000;

const cache = new Map<string, { at: number; result: IpGeoResult }>();

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "unknown") return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (ip.startsWith("172.") && second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return false;
}

function invalidResult(): IpGeoResult {
  return {
    countryCode: null,
    isProxy: true,
    isHosting: true,
    isValidMa: false,
    lookupOk: false,
  };
}

async function fetchGeo(ip: string): Promise<IpGeoResult> {
  if (isPrivateIp(ip)) return invalidResult();

  const fields = "status,countryCode,proxy,hosting";
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return invalidResult();
    const data = (await res.json()) as {
      status?: string;
      countryCode?: string;
      proxy?: boolean;
      hosting?: boolean;
    };
    if (data.status !== "success") return invalidResult();

    const countryCode = (data.countryCode ?? "").toUpperCase() || null;
    const isProxy = Boolean(data.proxy);
    const isHosting = Boolean(data.hosting);
    const isValidMa =
      countryCode === "MA" && !isProxy && !isHosting;

    return {
      countryCode,
      isProxy,
      isHosting,
      isValidMa,
      lookupOk: true,
    };
  } catch {
    return invalidResult();
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveIpGeo(ip: string): Promise<IpGeoResult> {
  const key = ip.trim();
  if (!key || isPrivateIp(key)) return invalidResult();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const result = await fetchGeo(key);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}
