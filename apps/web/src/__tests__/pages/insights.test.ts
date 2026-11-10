// ABOUTME: Tests for the insights page: the server-rendered week heading, refresh button and placeholders.
// ABOUTME: Also runs the page's client script against a stub DOM to check how it renders each summary response.

import { describe, it, expect } from 'vitest';
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

// A minimal DOM node: enough for the insights script to build, fill and hide elements.
class StubNode {
  readonly children: StubNode[] = [];
  className = '';
  hidden = false;
  disabled = false;
  private ownText = '';
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
    this.children.push(child);
    return child;
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
  element(id: string): StubNode;
  settle(): Promise<void>;
}

const settle = async (): Promise<void> => {
  // Two macrotask turns let every then() chain in the script settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Runs the page script with a stub document and internalFetch. Elements start hidden when the server HTML
 * renders them with the hidden attribute.
 */
async function runScript(pageHtml: string, summary: unknown): Promise<ScriptRun> {
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

  const responses: Record<string, unknown> = {
    '/api/internal/user-insights-summary': summary,
    '/api/internal/user-insights-recommendations': { data: [] },
    '/api/internal/user-insights-cooldown': { canRefresh: true, cooldownSeconds: 0 },
  };
  const internalFetch = (url: string) => {
    fetches.push(url);
    const body = responses[url.split('?')[0]] ?? { error: 'No stub' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };

  const quietConsole = { log: () => {}, error: () => {}, warn: () => {} };
  const noTimers = { setInterval: () => 0, clearInterval: () => {} };

  new Function('document', 'internalFetch', 'console', 'setInterval', 'clearInterval', pageScript(pageHtml))(
    document,
    internalFetch,
    quietConsole,
    noTimers.setInterval,
    noTimers.clearInterval,
  );
  await settle();

  return { fetches, innerHtmlWrites, element, settle };
}

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
