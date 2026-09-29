// ABOUTME: Typed errors raised by AI provider clients.
// ABOUTME: Lets callers tell expected provider refusals (geoblocks) from real failures.

const OPENAI_REGION_CODE = 'unsupported_country_region_territory';

/**
 * The provider refused the request because of where it came from.
 * Workers call providers from a colo near the visitor, so this is expected
 * for visitors in regions the provider doesn't serve.
 */
export class RegionUnsupportedError extends Error {
  constructor(public provider: 'openai') {
    super(`${provider} does not serve the region this request came from`);
    this.name = 'RegionUnsupportedError';
  }
}

/**
 * True when an OpenAI error response is the unsupported-region 403.
 */
export function isOpenAIRegionBlock(status: number, body: string): boolean {
  if (status !== 403) return false;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string } };
    return parsed.error?.code === OPENAI_REGION_CODE;
  } catch {
    return false;
  }
}
