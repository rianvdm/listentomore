// ABOUTME: Tests for the insights page: the server-rendered week heading, refresh button and placeholders.
// ABOUTME: Also runs the page's client script against a stub DOM to check how it renders the summary and the card.

import { describe, it, expect } from 'vitest';
import { checkCopyRubric } from '@listentomore/insights';
import { UserInsightsPage } from '../../pages/user/insights';

const DUPLICATES_COPY = 'Counts exclude likely duplicate scrobbles.';

function renderPage(isOwner: boolean): string {
  return UserInsightsPage({
    username: 'testuser',
    lastfmUsername: 'testuser',
    isOwner,
    profileVisibility: 'public',
  }).toString();
}

// The page's own script is the inline one that fetches the summary; Layout's inline scripts don't.
function pageScript(pageHtml: string): string {
  const scripts = [...pageHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((s) => s.includes('/api/internal/user-insights-summary'));
  if (!script) throw new Error('No insights script found in the page');
  return script;
}

// A minimal DOM node: enough for the insights script to build, fill, hide and remove elements.
class StubNode {
  readonly children: StubNode[] = [];
  parent: StubNode | null = null;
  className = '';
  hidden = false;
  disabled = false;
  private ownText = '';
  private readonly attributes = new Map<string, string>();
  private listeners: Record<string, Array<() => void>> = {};

  constructor(
    readonly tagName: string,
    private readonly innerHtmlWrites: string[],
  ) {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = String(value);
    this.children.length = 0;
  }

  // Records every write; keeps only the text so assertions read what a visitor would see.
  set innerHTML(value: string) {
    this.innerHtmlWrites.push(value);
    this.textContent = value.replace(/<[^>]*>/g, '');
  }

  appendChild(child: StubNode): StubNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners[type] ?? []) listener();
  }

  find(className: string): StubNode | undefined {
    for (const child of this.children) {
      if (child.className.split(' ').includes(className)) return child;
      const found = child.find(className);
      if (found) return found;
    }
    return undefined;
  }
}

interface ScriptRun {
  fetches: string[];
  innerHtmlWrites: string[];
  /** Every argument the script passed to any console method. */
  consoleArgs: unknown[];
  element(id: string): StubNode;
  settle(): Promise<void>;
}

/** A response body the test settles later: the script's json() waits on it. */
class Deferred {
  resolve!: (body: unknown) => void;
  reject!: (error: Error) => void;
  readonly promise = new Promise<unknown>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  constructor() {
    // A body rejected before the script reads it is not an unhandled rejection; the script's own catch still runs.
    this.promise.catch(() => {});
  }
}

const deferred = (): Deferred => new Deferred();

/** A stubbed response: a body, a Deferred body, or a function that returns one for each request in turn. */
type StubResponse = unknown;

const bodyFor = (response: StubResponse, call: number): Promise<unknown> => {
  const body = typeof response === 'function' ? (response as (call: number) => unknown)(call) : response;
  return body instanceof Deferred ? body.promise : Promise.resolve(body);
};

const settle = async (): Promise<void> => {
  // Two macrotask turns let every then() chain in the script settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Runs the page script with a stub document and internalFetch. Elements start hidden when the server HTML
 * renders them with the hidden attribute. onFetch runs inside internalFetch, before any response, so a test can
 * read the page at the moment a request starts.
 */
async function runScript(
  pageHtml: string,
  summary: StubResponse,
  card: StubResponse = { data: null },
  onFetch?: (url: string, element: (id: string) => StubNode) => void,
): Promise<ScriptRun> {
  const fetches: string[] = [];
  const innerHtmlWrites: string[] = [];
  const elements = new Map<string, StubNode>();

  const element = (id: string): StubNode => {
    let node = elements.get(id);
    if (!node) {
      node = new StubNode('div', innerHtmlWrites);
      const tag = pageHtml.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`));
      node.hidden = tag !== null && /\shidden(?:[\s=>])/.test(tag[0]);
      elements.set(id, node);
    }
    return node;
  };

  const document = {
    getElementById: element,
    createElement: (tagName: string) => new StubNode(tagName, innerHtmlWrites),
    createTextNode: (text: string) => {
      const node = new StubNode('#text', innerHtmlWrites);
      node.textContent = text;
      return node;
    },
  };

  const responses: Record<string, StubResponse> = {
    '/api/internal/user-insights-summary': summary,
    '/api/internal/user-insights-recommendations': { data: [] },
    '/api/internal/user-insights-cooldown': { canRefresh: true, cooldownSeconds: 0 },
    [TRIVIA]: card,
  };
  const calls = new Map<string, number>();
  const internalFetch = (url: string) => {
    fetches.push(url);
    onFetch?.(url, element);
    const path = url.split('?')[0];
    const call = calls.get(path) ?? 0;
    calls.set(path, call + 1);
    const body = bodyFor(path in responses ? responses[path] : { error: 'No stub' }, call);
    return Promise.resolve({ ok: true, status: 200, json: () => body });
  };

  const consoleArgs: unknown[] = [];
  const record = (...args: unknown[]): void => {
    consoleArgs.push(...args);
  };
  const quietConsole = { log: record, error: record, warn: record, info: record, debug: record };
  const noTimers = { setInterval: () => 0, clearInterval: () => {} };

  new Function('document', 'internalFetch', 'console', 'setInterval', 'clearInterval', pageScript(pageHtml))(
    document,
    internalFetch,
    quietConsole,
    noTimers.setInterval,
    noTimers.clearInterval,
  );
  await settle();

  return { fetches, innerHtmlWrites, consoleArgs, element, settle };
}

const TRIVIA = '/api/internal/user-insights-trivia';

const CARD = {
  kind: 'making_of',
  album: 'Inferno',
  artist: 'Boards of Canada',
  text: 'Inferno was recorded in two weeks.',
  sourceUrl: 'https://a.example/x',
  imageUrl: 'https://i.scdn.co/image/abc',
};

const week = {
  note: 'You played Eternal Embers by Meltt start to finish three times.',
  question: 'What started it?',
  header: 'Your week',
  pulledAt: '2026-11-08T14:30:00.000Z',
  mode: 'note',
};

describe('UserInsightsPage', () => {
  const owner = renderPage(true);
  const visitor = renderPage(false);

  it('owner sees the heading "Your week"', () => {
    expect(owner).toContain('<h2>Your week</h2>');
    expect(owner).toContain('id="refresh-btn"');
  });

  it('a visitor sees "<username>\'s week" and no refresh button', () => {
    expect(visitor).toContain('<h2>testuser&#39;s week</h2>');
    expect(visitor).not.toContain('Your week');
    expect(visitor).not.toContain('id="refresh-btn"');
  });

  it('the client script writes the note with textContent, not marked.parse', () => {
    const script = pageScript(owner);
    expect(script).toContain('textContent');
    expect(script).not.toContain('marked.parse(data.data.content)');
    expect(script).not.toContain('enrichLinks(');
  });

  it('the question renders in its own element', () => {
    expect(owner).toMatch(/<p[^>]*id="insights-question"[^>]*\shidden/);
  });

  it('shows when the data was pulled and that counts exclude likely duplicate scrobbles', () => {
    expect(owner).toMatch(/<p[^>]*id="insights-meta"[^>]*\shidden/);
    expect(pageScript(owner)).toContain(DUPLICATES_COPY);
  });

  it('the loading text no longer says "Analyzing your listening"', () => {
    expect(owner).toContain('Reading your week...');
    expect(owner).not.toContain('Analyzing your listening');
    expect(visitor).toContain('Reading testuser&#39;s week...');
  });

  it('a "refreshing" response shows "Updating..." beside the note', () => {
    expect(pageScript(owner)).toContain('Updating...');
  });
});

describe('insights client script', () => {
  const owner = renderPage(true);
  const visitor = renderPage(false);

  it('fetches the summary for the profile', async () => {
    const run = await runScript(owner, { data: week });
    expect(run.fetches).toContain('/api/internal/user-insights-summary?username=testuser');
  });

  it('shows the note, the question and the meta line to the owner', async () => {
    const run = await runScript(owner, { data: week });
    expect(run.element('insights-summary').textContent).toBe(week.note);
    const question = run.element('insights-question');
    expect(question.hidden).toBe(false);
    expect(question.textContent).toBe('What started it?');
    const meta = run.element('insights-meta');
    expect(meta.hidden).toBe(false);
    expect(meta.textContent).toMatch(/^Updated .+\. Counts exclude likely duplicate scrobbles\.$/);
    expect(meta.textContent).not.toContain('2026-11-08T');
  });

  it('never parses response text as HTML', async () => {
    const hostile = {
      ...week,
      note: '<img src=x onerror="alert(1)">',
      question: '<b>bold</b>',
    };
    const run = await runScript(owner, { data: hostile });
    expect(run.element('insights-summary').textContent).toBe(hostile.note);
    expect(run.element('insights-question').textContent).toBe(hostile.question);
    expect(run.innerHtmlWrites.join('\n')).not.toContain('<img');
    expect(run.innerHtmlWrites.join('\n')).not.toContain('<b>');
  });

  it('keeps the question hidden when it is null', async () => {
    const run = await runScript(owner, { data: { ...week, question: null } });
    expect(run.element('insights-question').hidden).toBe(true);
    expect(run.element('insights-meta').hidden).toBe(false);
  });

  it('never shows a question to a visitor', async () => {
    const run = await runScript(visitor, {
      data: { ...week, header: "testuser's week", mode: 'line', question: 'What started it?' },
    });
    expect(run.element('insights-question').hidden).toBe(true);
    expect(run.element('insights-meta').hidden).toBe(false);
    expect(run.fetches.some((url) => url.startsWith('/api/internal/user-insights-cooldown'))).toBe(false);
  });

  it('marks a refreshing note with "Updating..."', async () => {
    const run = await runScript(owner, { data: { ...week, refreshing: true } });
    const summary = run.element('insights-summary');
    expect(summary.find('insights-updating')?.textContent).toBe('Updating...');
    expect(summary.textContent).toBe(`${week.note} Updating...`);
  });

  it('shows no "Updating..." on a settled note', async () => {
    const run = await runScript(owner, { data: week });
    expect(run.element('insights-summary').find('insights-updating')).toBeUndefined();
  });

  it('leaves out the time when pulledAt is not a date', async () => {
    const run = await runScript(owner, { data: { ...week, pulledAt: 'not a date' } });
    expect(run.element('insights-meta').textContent).toBe(DUPLICATES_COPY);
  });

  it('shows the sparse message as text and hides the question and meta line', async () => {
    const run = await runScript(owner, { data: null, sparse: true, message: 'Only <i>two</i> plays so far.' });
    expect(run.element('insights-summary').textContent).toBe('Only <i>two</i> plays so far.');
    expect(run.element('insights-question').hidden).toBe(true);
    expect(run.element('insights-meta').hidden).toBe(true);
  });

  it('shows the error message on an error response', async () => {
    const run = await runScript(owner, { error: 'Failed to load insights' });
    expect(run.element('insights-summary').textContent).toBe(
      'Unable to generate insights right now. Please try again later.',
    );
    expect(run.element('insights-question').hidden).toBe(true);
    expect(run.element('insights-meta').hidden).toBe(true);
  });

  it('hides the question and meta line while a refresh loads', async () => {
    const run = await runScript(owner, { data: week });
    expect(run.element('insights-question').hidden).toBe(false);
    run.element('refresh-btn').dispatch('click');
    expect(run.element('insights-question').hidden).toBe(true);
    expect(run.element('insights-meta').hidden).toBe(true);
    expect(run.element('insights-summary').textContent).toBe('Reading your week...');
    expect(run.fetches).toContain('/api/internal/user-insights-summary?username=testuser&refresh=true');
    await run.settle();
    expect(run.element('insights-question').hidden).toBe(false);
  });
});

describe('the Did you know card', () => {
  const owner = renderPage(true);
  const visitor = renderPage(false);

  it('renders an empty, hidden card after the meta line', () => {
    expect(owner).toMatch(/id="insights-meta"[\s\S]*<aside id="insights-card" class="insights-card" hidden=""><\/aside>/);
  });

  it('hides [hidden] cards even though the card sets display', () => {
    expect(owner).toMatch(/\.insights-card \{[^}]*display: flex;/);
    expect(owner).toContain('.insights-card[hidden] { display: none; }');
  });

  it('uses copy that passes the rubric', () => {
    // "Did you know" is the label the design names for the card. The rubric flags it as an announcing opener in fact
    // text, which is where it must never appear; as a fixed heading above the fact it announces nothing.
    expect(checkCopyRubric('Source', [])).toEqual([]);
    expect(checkCopyRubric('Inferno by Boards of Canada', ['Inferno', 'Boards of Canada'])).toEqual([]);
    expect(pageScript(owner)).toContain("'Did you know'");
    expect(pageScript(owner)).toContain("' by '");
    expect(pageScript(owner)).not.toContain('\u2014');
  });

  it('requests the card only after the summary renders', async () => {
    const summary = deferred();
    const noteAtCardFetch: Array<string | undefined> = [];
    const run = await runScript(owner, summary, { data: CARD }, (url, el) => {
      if (url.startsWith(TRIVIA)) noteAtCardFetch.push(el('insights-summary').find('insights-note')?.textContent);
    });
    expect(noteAtCardFetch).toEqual([]);
    summary.resolve({ data: week });
    await run.settle();
    // The note was in the DOM at the moment the card request started.
    expect(noteAtCardFetch).toEqual([week.note]);
    expect(run.fetches).toContain(`${TRIVIA}?username=testuser`);
  });

  it('renders art, label, album and artist, text and Source link through attributes and textContent', async () => {
    const run = await runScript(owner, { data: week }, { data: CARD });
    const card = run.element('insights-card');
    expect(card.hidden).toBe(false);
    const img = card.find('insights-card-art')!;
    expect([img.getAttribute('src'), img.getAttribute('alt'), img.getAttribute('loading')]).toEqual([
      CARD.imageUrl,
      '',
      'lazy',
    ]);
    expect(['insights-card-label', 'insights-card-album', 'insights-card-text'].map((c) => card.find(c)?.textContent))
      .toEqual(['Did you know', 'Inferno by Boards of Canada', CARD.text]);
    const source = card.find('insights-card-source')!;
    expect([source.textContent, source.getAttribute('href'), source.getAttribute('target'), source.getAttribute('rel')])
      .toEqual(['Source', CARD.sourceUrl, '_blank', 'noopener noreferrer']);
    expect(run.innerHtmlWrites.join('')).not.toContain(CARD.text);
    img.dispatch('error');
    expect(card.find('insights-card-art')).toBeUndefined();
    expect(card.find('insights-card-text')?.textContent).toBe(CARD.text);
  });

  it('shows the card to a visitor too', async () => {
    const run = await runScript(visitor, { data: { ...week, mode: 'line', question: null } }, { data: CARD });
    expect(run.element('insights-card').hidden).toBe(false);
    expect(run.element('insights-card').find('insights-card-text')?.textContent).toBe(CARD.text);
  });

  it('never parses card text as HTML', async () => {
    const hostile = { ...CARD, album: '<b>Inferno</b>', text: '<img src=x onerror="alert(1)">' };
    const run = await runScript(owner, { data: week }, { data: hostile });
    const card = run.element('insights-card');
    expect(card.find('insights-card-album')?.textContent).toBe('<b>Inferno</b> by Boards of Canada');
    expect(card.find('insights-card-text')?.textContent).toBe(hostile.text);
    expect(run.innerHtmlWrites.join('\n')).not.toContain('<img src=x');
    expect(run.innerHtmlWrites.join('\n')).not.toContain('<b>Inferno');
  });

  it('shows no image or Source link for a URL that is not https', async () => {
    const run = await runScript(owner, { data: week }, {
      data: { ...CARD, sourceUrl: 'javascript:alert(1)', imageUrl: 'http://i.example/a' },
    });
    const card = run.element('insights-card');
    expect(card.hidden).toBe(false);
    expect(card.find('insights-card-art')).toBeUndefined();
    expect(card.find('insights-card-source')).toBeUndefined();
    expect(card.find('insights-card-text')?.textContent).toBe(CARD.text);
  });

  it('shows no image or Source link when the card has none', async () => {
    const { sourceUrl: _source, imageUrl: _image, ...bare } = CARD;
    const run = await runScript(owner, { data: week }, { data: bare });
    const card = run.element('insights-card');
    expect(card.hidden).toBe(false);
    expect(card.find('insights-card-text')?.textContent).toBe(CARD.text);
    expect(card.find('insights-card-art')).toBeUndefined();
    expect(card.find('insights-card-source')).toBeUndefined();
  });

  it('keeps the card hidden and empty when data is null or the request fails', async () => {
    const failed = deferred();
    failed.reject(new Error('Network down'));
    for (const response of [{ data: null }, { error: 'Failed to load card' }, { data: { kind: 'tieback' } }, failed]) {
      const run = await runScript(owner, { data: week }, response);
      expect(run.fetches.some((url) => url.startsWith(TRIVIA))).toBe(true);
      const card = run.element('insights-card');
      expect(card.hidden).toBe(true);
      expect(card.textContent).toBe('');
    }
  });

  it('hides and empties the card while a refresh loads', async () => {
    const run = await runScript(owner, { data: week }, { data: CARD });
    const card = run.element('insights-card');
    expect(card.hidden).toBe(false);
    run.element('refresh-btn').dispatch('click');
    expect(card.hidden).toBe(true);
    expect(card.textContent).toBe('');
    await run.settle();
    expect(card.hidden).toBe(false);
    expect(run.fetches.filter((url) => url.startsWith(TRIVIA))).toHaveLength(2);
  });

  it('drops a card that arrives after a refresh started', async () => {
    const lateCard = deferred();
    const refreshedSummary = deferred();
    const run = await runScript(owner, (call: number) => (call === 0 ? { data: week } : refreshedSummary), lateCard);
    run.element('refresh-btn').dispatch('click');
    lateCard.resolve({ data: CARD });
    await run.settle();
    const card = run.element('insights-card');
    expect(card.hidden).toBe(true);
    expect(card.textContent).toBe('');
  });

  // The initial summary is still loading when Refresh is clicked, then answers after it.
  for (const [name, refreshed, summaryText] of [
    ['sparse', { data: null, sparse: true, message: 'Only two plays so far.' }, 'Only two plays so far.'],
    ['failed', { error: 'Failed' }, 'Unable to generate insights right now. Please try again later.'],
  ] as const) {
    it(`ignores the initial summary once a refresh started, then shows the ${name} refresh with no card`, async () => {
      const initial = deferred();
      const refreshedSummary = deferred();
      const run = await runScript(owner, (call: number) => (call === 0 ? initial : refreshedSummary), { data: CARD });
      run.element('refresh-btn').dispatch('click');
      initial.resolve({ data: week });
      await run.settle();
      expect(run.element('insights-summary').textContent).toBe('Reading your week...');
      refreshedSummary.resolve(refreshed);
      await run.settle();
      expect(run.element('insights-summary').textContent).toBe(summaryText);
      const card = run.element('insights-card');
      expect(card.hidden).toBe(true);
      expect(card.textContent).toBe('');
      expect(run.fetches.some((url) => url.startsWith(TRIVIA))).toBe(false);
    });

    it(`keeps the ${name} refresh when the initial summary answers last`, async () => {
      const initial = deferred();
      const run = await runScript(owner, (call: number) => (call === 0 ? initial : refreshed), { data: CARD });
      run.element('refresh-btn').dispatch('click');
      await run.settle();
      initial.resolve({ data: week });
      await run.settle();
      expect(run.element('insights-summary').textContent).toBe(summaryText);
      expect(run.element('insights-card').hidden).toBe(true);
      expect(run.fetches.some((url) => url.startsWith(TRIVIA))).toBe(false);
    });
  }

  it('logs a fixed code when the card fails, never the response contents', async () => {
    const SENTINEL = 'upstream-body-7f3a';
    const rejected = deferred();
    rejected.reject(new SyntaxError(`Unexpected token in JSON: ${SENTINEL}`));
    const run = await runScript(owner, { data: week }, rejected);
    expect(run.fetches.some((url) => url.startsWith(TRIVIA))).toBe(true);
    expect(run.element('insights-card').hidden).toBe(true);
    expect(run.consoleArgs).toContain('[Insights] card load failed');
    for (const arg of run.consoleArgs) {
      expect(arg).not.toBeInstanceOf(Error);
      expect(String(arg)).not.toContain(SENTINEL);
    }
  });

  it('logs a fixed code when the summary fails, never the response contents', async () => {
    const SENTINEL = 'upstream-body-9c1e';
    const rejected = deferred();
    rejected.reject(new SyntaxError(`Unexpected token in JSON: ${SENTINEL}`));
    const run = await runScript(owner, rejected, { data: CARD });
    expect(run.element('insights-summary').textContent).toBe(
      'Unable to generate insights right now. Please try again later.',
    );
    expect(run.consoleArgs).toContain('[Insights] summary load failed');
    for (const arg of run.consoleArgs) {
      expect(arg).not.toBeInstanceOf(Error);
      expect(String(arg)).not.toContain(SENTINEL);
    }
  });

  it('never requests the card on a sparse week or a failed summary', async () => {
    for (const summary of [{ data: null, sparse: true, message: 'Only two plays so far.' }, { error: 'Failed' }]) {
      const run = await runScript(owner, summary, { data: CARD });
      expect(run.fetches.some((url) => url.startsWith(TRIVIA))).toBe(false);
      expect(run.element('insights-card').hidden).toBe(true);
    }
  });
});
