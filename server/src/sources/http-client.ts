export interface HttpClient {
  getJson<T>(url: string, init?: { headers?: Record<string, string> }): Promise<T>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface PoliteHttpClientOptions {
  allowedHosts: Iterable<string>;
  userAgent: string | (() => string);
  timeoutMs?: number;
  minIntervalMsPerHost?: number;
  maxRetries?: number;
  maxBodyBytes?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only way sources reach the network. Guardrails:
 *  - HTTPS only, and only to hosts a registered source declared (no open fetches).
 *  - At most one request per host per interval, with backoff on 429/5xx.
 *  - Hard timeout and response-size cap.
 *  - Never logs request headers, which carry API keys.
 */
export class PoliteHttpClient implements HttpClient {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly nextSlotByHost = new Map<string, number>();
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly maxBodyBytes: number;

  constructor(private readonly options: PoliteHttpClientOptions) {
    this.allowedHosts = new Set([...options.allowedHosts].map((h) => h.toLowerCase()));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minIntervalMs = options.minIntervalMsPerHost ?? 1_200;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxBodyBytes = options.maxBodyBytes ?? 15 * 1024 * 1024;
  }

  async getJson<T>(rawUrl: string, init: { headers?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') throw new Error(`Refusing non-HTTPS request to ${url.host}`);
    if (!this.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error(`Refusing request to non-allowlisted host ${url.hostname}`);
    }

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot(url.hostname);
      const response = await fetch(url, {
        headers: { 'User-Agent': typeof this.options.userAgent === 'function' ? this.options.userAgent() : this.options.userAgent, Accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      });

      if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 1_000 * 2 ** (attempt + 1);
        await response.body?.cancel();
        await sleep(delay);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(`${url.hostname} responded ${response.status}`, response.status);
      }

      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > this.maxBodyBytes) {
        await response.body?.cancel();
        throw new Error(`Response from ${url.hostname} is too large`);
      }
      const text = await response.text();
      if (text.length > this.maxBodyBytes) throw new Error(`Response from ${url.hostname} is too large`);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`${url.hostname} returned invalid JSON`);
      }
    }
  }

  private async waitForSlot(host: string): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotByHost.get(host) ?? 0);
    this.nextSlotByHost.set(host, slot + this.minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }
}
