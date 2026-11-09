// ABOUTME: Runs a detail page's inline progressive-loading script against stub browser globals.
// ABOUTME: Lets page tests check what the client script fetches and renders, not only its source text.

/** JSON bodies for internalFetch, keyed by path (the URL before '?'). Unlisted paths get an error body. */
export type StubResponses = Record<string, unknown>;

export interface PageScriptRun {
  /** Every URL the script passed to internalFetch, in call order. */
  fetches: string[];
  /** The innerHTML the script left on an element, or '' when it never wrote one. */
  html(id: string): string;
  /** Element ids whose links enrichLinks scanned, each listed once. */
  enriched: string[];
}

interface StubElement {
  innerHTML: string;
  style: Record<string, string>;
  querySelectorAll(selector: string): never[];
}

// The page's own script is the inline one that defines enrichLinks; Layout's inline scripts don't.
function pageScript(pageHtml: string): string {
  const scripts = [...pageHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((s) => s.includes('function enrichLinks('));
  if (!script) throw new Error('No progressive-loading script found in the page');
  return script;
}

/**
 * Executes the page script with stubbed window, document, internalFetch and marked, then waits for
 * its fetch chains to settle. marked.parse wraps text in <p> so tests can find the rendered summary.
 */
export async function runPageScript(
  pageHtml: string,
  { authenticated, responses = {} }: { authenticated: boolean; responses?: StubResponses },
): Promise<PageScriptRun> {
  const fetches: string[] = [];
  const enriched = new Set<string>();
  const elements = new Map<string, StubElement>();

  const document = {
    getElementById(id: string): StubElement {
      let element = elements.get(id);
      if (!element) {
        element = {
          innerHTML: '',
          style: {},
          querySelectorAll: () => {
            enriched.add(id);
            return [];
          },
        };
        elements.set(id, element);
      }
      return element;
    },
  };

  const internalFetch = (url: string) => {
    fetches.push(url);
    const path = url.split('?')[0];
    const body = path in responses ? responses[path] : { error: `No stub for ${path}` };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };

  const window = { __IS_AUTHENTICATED__: authenticated } as Record<string, unknown>;
  const marked = { parse: (text: string) => `<p>${text}</p>` };
  const quietConsole = { log: () => {}, error: () => {}, warn: () => {} };

  new Function('window', 'document', 'internalFetch', 'marked', 'console', pageScript(pageHtml))(
    window,
    document,
    internalFetch,
    marked,
    quietConsole,
  );

  // Two macrotask turns let every then() chain in the script settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    fetches,
    html: (id) => elements.get(id)?.innerHTML ?? '',
    enriched: [...enriched],
  };
}
