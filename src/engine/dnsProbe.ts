
import { invoke } from "@tauri-apps/api/core";
import { isAndroid } from "../utils/platform";

// Bootstrap DoH candidates, sorted by historical reachability from
// RU networks. The literal-IP DoH URLs bypass the OS resolver, which
// is what we want for the bootstrap phase — at this point the tunnel
// is not up yet and the user's ISP may be DNS-hijacking.
//
// `host` is the `ip:port` we probe with a single TCP connect. If the
// connect succeeds within `PROBE_TIMEOUT_MS`, we treat the matching
// `url` as reachable.
const BOOTSTRAP_CANDIDATES: { url: string; host: string }[] = [
  { url: "https://1.1.1.1/dns-query", host: "1.1.1.1:443" },
  { url: "https://8.8.8.8/dns-query", host: "8.8.8.8:443" },
  { url: "https://9.9.9.9/dns-query", host: "9.9.9.9:443" },
  { url: "https://94.140.14.14/dns-query", host: "94.140.14.14:443" },
  { url: "https://77.88.8.8/dns-query", host: "77.88.8.8:443" },
  { url: "https://1.0.0.1/dns-query", host: "1.0.0.1:443" },
  { url: "https://8.8.4.4/dns-query", host: "8.8.4.4:443" },
];

const FALLBACK_URL = "https://1.1.1.1/dns-query";
const PROBE_TIMEOUT_MS = 1500;

let cachedPromise: Promise<string> | null = null;

async function probeOne(host: string): Promise<boolean> {
  try {
    // Reuse the existing `ping_test` Tauri command — single attempt,
    // bare-TCP (no TLS handshake), short timeout. We only care whether
    // we can open a TCP connection to ip:443, not the actual RTT.
    await invoke<number>("ping_test", {
      host,
      attempts: 1,
      timeoutMs: PROBE_TIMEOUT_MS,
      tlsHandshake: false,
    });
    return true;
  } catch {
    return false;
  }
}

// Race the probes — return the URL of the first candidate that
// responds. We deliberately keep evaluation strictly in-order (early
// candidates win on tie) so the default stays Cloudflare when the
// network is healthy, and only flips to a fallback when Cloudflare is
// actually unreachable.
async function probeInOrder(): Promise<string> {
  for (const c of BOOTSTRAP_CANDIDATES) {
    if (await probeOne(c.host)) {
      return c.url;
    }
  }
  return FALLBACK_URL;
}

export async function resolveAutoBootstrapDoH(): Promise<string> {
  if (isAndroid()) {
    // The Android plugin builds its own sing-box config from the
    // Tauri-side template, but `ping_test` is desktop-only — fall
    // back to the static default rather than blocking on a probe that
    // can't run.
    return FALLBACK_URL;
  }
  if (!cachedPromise) {
    cachedPromise = probeInOrder().catch(() => FALLBACK_URL);
  }
  return cachedPromise;
}

// Invalidate the cache — used when the user toggles connectivity or
// switches networks and we want a fresh probe on the next connect.
export function invalidateAutoBootstrapDoH(): void {
  cachedPromise = null;
}

// Sentinel value stored in `mint.dns.local` when the user picks the
// "Авто" preset in Settings. Kept here so the engine layer and the
// settings UI can't drift.
export const AUTO_LOCAL_DNS = "auto";
