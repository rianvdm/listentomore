// ABOUTME: Tests for the prompt view, the note signature and the code-rendered lines for owners and visitors.
// ABOUTME: Follows spec section 2 ("Prompt view", "Quiet week"), section 4 (owner and visitor) and section 5 (reuse rule).

import { albumKey, buildWeekFacts, noteSignature, renderLine, renderPromptView } from '../src';
import type { Fact, FactKind, Tier, WeekFacts } from '../src';
import { NOW, loadFixture, makeInputs, plays, ts } from './helpers';

const FIXTURES = ['bordesak-2026-05-24', 'bordesak-2026-05-31', 'bordesak-2026-06-12'];
const CLOCK = /\d{1,2}:\d{2}\s?(?:AM|PM)/i;

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');
const FRI = ts('2026-11-06T10:00:00');
const SAT_MAY_30 = ts('2026-05-30T18:00:00');

/** Three start-to-finish listens of a 6-track album nobody had played before: a repeat_album fact clamped to 100. */
function melttWeek(): WeekFacts {
  const tracks = ['a', 'b', 'c', 'd', 'e', 'f'];
  const listen = (start: number) => tracks.map((track, i) => ({ artist: 'Meltt', album: 'Eternal Embers', track, ts: start + i * 240 }));
  return buildWeekFacts(makeInputs({
    username: 'bordesak',
    scrobbles: [...listen(MON), ...listen(WED), ...listen(FRI)],
    albums: { [albumKey('Meltt', 'Eternal Embers')]: { tracklist: tracks, userPlaycount: 18, fetchedAt: NOW } },
  }));
}

/** A WeekFacts whose rank-1 fact is `lead`, for rendering one fact kind. */
const leading = (wf: WeekFacts, lead: Fact): WeekFacts => ({ ...wf, facts: [{ ...lead, id: 1 }], quiet: false });

/** Puts Siiga, at 12 plays, at the top of the week's artists, as a discovery lead would be. */
const withSiiga = (wf: WeekFacts): WeekFacts => ({
  ...wf, topArtists: [{ artist: 'Siiga', plays: 12, tier: 'barely_known', nameUncertain: false }, ...wf.topArtists],
});

/** Removes every name the week knows, so punctuation inside names ("Delirious?") does not count. */
const withoutNames = (text: string, wf: WeekFacts): string =>
  [...wf.names].sort((a, b) => b.length - a.length).reduce((t, name) => t.split(name).join('#'), text);

const sample = (kind: FactKind, over: Partial<Fact>): Fact => ({
  id: 1, kind, salience: 70, subject: null, statement: 'Unused by the line.', entities: [], quantities: [], dates: [], edges: [], ...over,
});

/** One fact per kind, typed the way the fact rules type them (entities and quantities in statement order). */
const SAMPLES: Record<FactKind, { fact: Fact; second: string }> = {
  discovery: {
    fact: sample('discovery', {
      subject: 'Siiga', entities: ['Siiga'],
      quantities: [{ value: 5, unit: 'plays', entity: 'Siiga' }, { value: 12, unit: 'plays', entity: 'Siiga' },
        { value: 3, unit: 'days', entity: 'Siiga' }],
    }),
    second: 'You played Siiga 12 times this week, after only 5 plays before this week.',
  },
  repeat_album: {
    fact: sample('repeat_album', {
      subject: 'Meltt', entities: ['Eternal Embers', 'Meltt'],
      quantities: [{ value: 3, unit: 'times', entity: 'Eternal Embers' }, { value: 2, unit: 'times', entity: 'Eternal Embers' },
        { value: 30, unit: 'plays', entity: 'Meltt' }],
    }),
    second: 'You played Eternal Embers by Meltt start to finish 3 times this week.',
  },
  volume_vs_normal: {
    fact: sample('volume_vs_normal', {
      subject: 'Boards of Canada', entities: ['Boards of Canada'],
      quantities: [{ value: 41, unit: 'plays', entity: 'Boards of Canada' }, { value: 2, unit: 'plays', entity: 'Boards of Canada' },
        { value: 12, unit: 'weeks' }],
    }),
    second: 'You played Boards of Canada 41 times this week, at 3 or more times your usual rate.',
  },
  volume_spread: {
    fact: sample('volume_spread', {
      entities: ['A', 'B', 'C', 'D'],
      quantities: [{ value: 4, unit: 'artists' }, { value: 3, unit: 'times' }, { value: 12, unit: 'weeks' }],
    }),
    second: 'You played 4 artists at 3 or more times your usual rate this week, including A.',
  },
  genre_cluster: {
    fact: sample('genre_cluster', {
      subject: 'jazz', entities: ['Wes Montgomery', 'Wayne Shorter', 'Joe Henderson', 'Grant Green'],
      quantities: [{ value: 4, unit: 'artists' }, { value: 1, unit: 'weeks' }, { value: 8, unit: 'plays', entity: 'Wes Montgomery' }],
    }),
    second: 'You played 4 jazz artists this week that had been away for months or had few or no plays before this week, led by Wes Montgomery.',
  },
  returns: {
    fact: sample('returns', {
      subject: 'Joe Henderson', entities: ['Joe Henderson', 'Tracy Chapman', 'Crossroads'],
      quantities: [{ value: 6, unit: 'plays', entity: 'Joe Henderson' }, { value: 40, unit: 'plays', entity: 'Joe Henderson' },
        { value: 12, unit: 'months', entity: 'Joe Henderson' }, { value: 9, unit: 'tracks', entity: 'Crossroads' },
        { value: 6, unit: 'months', entity: 'Tracy Chapman' }],
    }),
    second: 'You came back to Joe Henderson and 1 other artist this week after months away.',
  },
  breadth: {
    fact: sample('breadth', {
      entities: ['A', 'B'],
      quantities: [{ value: 27, unit: 'artists' }, { value: 10, unit: 'plays' }, { value: 18, unit: 'artists' }, { value: 12, unit: 'weeks' }],
    }),
    second: 'You played 27 artists 10 or more times this week, against a usual 18.',
  },
  single_listen: {
    fact: sample('single_listen', {
      subject: 'Boards of Canada', entities: ['Boards of Canada', 'Inferno'],
      quantities: [{ value: 0, unit: 'plays', entity: 'Inferno' }], dates: [SAT_MAY_30],
    }),
    second: 'You played Inferno by Boards of Canada start to finish on Sat May 30.',
  },
  album_chain: {
    fact: sample('album_chain', {
      entities: ['First', 'Art', 'Second', 'Third', 'Other'], quantities: [{ value: 3, unit: 'albums' }], dates: [SAT_MAY_30],
    }),
    second: 'You played 3 albums back to back, start to finish, on Sat May 30, starting with First.',
  },
  album_mode: {
    fact: sample('album_mode', {
      quantities: [{ value: 5, unit: 'times' }, { value: 3, unit: 'albums' }, { value: 38, unit: 'percent' }, { value: 8, unit: 'tracks' },
        { value: 1, unit: 'albums' }, { value: 5, unit: 'weeks' }, { value: 4, unit: 'weeks' }, { value: 20, unit: 'percent' }],
    }),
    second: '38% of your plays this week came in runs of 8 or more tracks from one album, the highest share of the last 5 weeks.',
  },
  last_week_faded: {
    fact: sample('last_week_faded', {
      entities: ['Tycho', 'Bonobo'],
      quantities: [{ value: 30, unit: 'plays', entity: 'Tycho' }, { value: 0, unit: 'plays', entity: 'Tycho' }],
    }),
    second: 'Tycho and 1 other artist from your top artists last week had few or no plays this week.',
  },
  themed_block: {
    fact: sample('themed_block', {
      entities: ['W', 'X', 'Y', 'Z'], dates: [SAT_MAY_30],
      quantities: [{ value: 14, unit: 'plays' }, { value: 5, unit: 'artists' }, { value: 12, unit: 'percent' }],
    }),
    second: 'You played 14 tracks from 5 artists in one stretch on Sat May 30, led by W.',
  },
  volume: {
    fact: sample('volume', {
      quantities: [{ value: 412, unit: 'plays' }, { value: 25, unit: 'percent' }, { value: 4, unit: 'weeks' }, { value: 330, unit: 'plays' },
        { value: 60, unit: 'artists' }, { value: 50, unit: 'artists' }],
    }),
    second: 'You had 412 plays this week, against a usual 330.',
  },
};

function expectPlainLine(line: string): void {
  expect(line).toMatch(/\.$/);
  expect(line).not.toMatch(/[—–?]|stop/i);
  expect(line).not.toContain('Unused');
}

describe('renderPromptView', () => {
  it('prompt view lists the window line as fact 0 and the top six facts by id', () => {
    const wf = buildWeekFacts(loadFixture('bordesak-2026-06-12'));
    expect(wf.facts.length).toBeGreaterThan(6);
    const lines = renderPromptView(wf).split('\n');
    expect(lines[0]).toBe(`0. ${wf.windowFact.statement}`);
    expect(lines[0]).toMatch(/^0\. Week: /);
    const numbered = lines.filter((l) => /^\d+\. /.test(l));
    expect(numbered).toEqual([`0. ${wf.windowFact.statement}`, ...wf.facts.slice(0, 6).map((f) => `${f.id}. ${f.statement}`)]);
    expect(lines.some((l) => l.startsWith('7.'))).toBe(false);
    expect(lines.some((l) => l.startsWith('Top artists this week'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Caveats: ') && l.includes('counts exclude likely duplicate scrobbles'))).toBe(true);
  });

  it('prompt view never contains a question', () => {
    for (const n of FIXTURES) {
      const wf = buildWeekFacts(loadFixture(n));
      const view = renderPromptView(wf);
      if (wf.question) expect(view).not.toContain(wf.question.text);
      for (const line of view.split('\n')) expect(withoutNames(line, wf)).not.toContain('?');
    }
  });

  it('prompt view omits times of day when timezone is null', () => {
    for (const n of FIXTURES) {
      expect(renderPromptView(buildWeekFacts({ ...loadFixture(n), timezone: null }))).not.toMatch(CLOCK);
      expect(renderPromptView(buildWeekFacts(loadFixture(n)))).not.toMatch(CLOCK); // statements name days only
    }
  });

  it('prompt view of an empty week says there are no ranked facts', () => {
    const view = renderPromptView(buildWeekFacts(makeInputs({})));
    expect(view).toContain('0. Week: Sun Nov 1 to Sun Nov 8 (rolling 7 days). 0 plays.');
    expect(view).toContain('No ranked facts this week.');
  });
});

describe('noteSignature', () => {
  const wf = buildWeekFacts(loadFixture('bordesak-2026-06-12')); // nine facts, so a seventh exists

  it('is 16 hex characters and stable', async () => {
    const sig = await noteSignature(wf, 'v1');
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
    expect(await noteSignature(buildWeekFacts(loadFixture('bordesak-2026-06-12')), 'v1')).toBe(sig);
  });

  it('signature ignores the window and pulledAt, changes with any top-six statement', async () => {
    const sig = await noteSignature(wf, 'v1');
    expect(await noteSignature({ ...wf, window: { from: 1, to: 2 }, pulledAt: 3 }, 'v1')).toBe(sig);
    const changed = (i: number): WeekFacts => ({
      ...wf, facts: wf.facts.map((f, j) => (j === i ? { ...f, statement: `${f.statement} More.` } : f)),
    });
    for (const i of [0, 5]) expect(await noteSignature(changed(i), 'v1')).not.toBe(sig);
    expect(wf.facts.length).toBeGreaterThan(6);
    expect(await noteSignature(changed(6), 'v1')).toBe(sig); // the seventh fact is not in the prompt view
    expect(await noteSignature({ ...wf, caveats: [...wf.caveats, 'another'] }, 'v1')).not.toBe(sig);
    expect(await noteSignature({ ...wf, topArtists: wf.topArtists.slice(1) }, 'v1')).not.toBe(sig);
  });

  it('signature changes when the window fact\'s play count or average changes', async () => {
    const sig = await noteSignature(wf, 'v1');
    const withWindow = (quantities: WeekFacts['windowFact']['quantities']): WeekFacts => ({
      ...wf, windowFact: { ...wf.windowFact, quantities },
    });
    const [days, plays, average] = wf.windowFact.quantities;
    expect(plays.unit).toBe('plays');
    expect(await noteSignature(withWindow([days, { ...plays, value: plays.value + 15 }, average]), 'v1')).not.toBe(sig);
    expect(await noteSignature(withWindow([days, plays, { ...average, value: average.value + 1 }]), 'v1')).not.toBe(sig);
  });

  it('signature ignores the window fact\'s days, which move daily', async () => {
    const sig = await noteSignature(wf, 'v1');
    const moved: WeekFacts = {
      ...wf,
      window: { from: wf.window.from + 3600, to: wf.window.to + 3600 },
      pulledAt: wf.pulledAt + 3600,
      windowFact: { ...wf.windowFact, statement: wf.windowFact.statement.replace('Fri Jun 12', 'Sat Jun 13'), dates: [1, 2] },
    };
    expect(moved.windowFact.statement).not.toBe(wf.windowFact.statement);
    expect(await noteSignature(moved, 'v1')).toBe(sig);
  });

  it('signature changes with the rule version and the prompt version', async () => {
    const sig = await noteSignature(wf, 'v1');
    expect(await noteSignature(wf, 'v2')).not.toBe(sig);
    expect(await noteSignature({ ...wf, ruleVersion: 'r2' }, 'v1')).not.toBe(sig);
  });
});

describe('renderLine', () => {
  it('second-person line for a repeat album', () => {
    const wf = melttWeek();
    expect(wf.facts[0]).toMatchObject({ kind: 'repeat_album', salience: 100 });
    expect(renderLine(wf, 'second')).toBe('You played Eternal Embers by Meltt start to finish 3 times this week.');
  });

  it('third-person line uses the username', () => {
    expect(renderLine(melttWeek(), 'third')).toBe('bordesak played Eternal Embers by Meltt start to finish 3 times this week.');
  });

  it('every fact kind has a line in both persons and none contains an em dash', () => {
    const base = withSiiga(melttWeek());
    for (const [kind, { fact, second }] of Object.entries(SAMPLES)) {
      const wf = leading(base, fact);
      expect(renderLine(wf, 'second'), kind).toBe(second);
      const third = renderLine(wf, 'third');
      expect(third, kind).toContain('bordesak');
      expect(third, kind).not.toMatch(/\byou(r)?\b/i);
      for (const line of [second, third]) expectPlainLine(line);
    }
  });

  it('third-person lines for each wording', () => {
    const third = (kind: FactKind): string => renderLine(leading(withSiiga(melttWeek()), SAMPLES[kind].fact), 'third');
    expect(third('discovery')).toBe('bordesak played Siiga 12 times this week, after only 5 plays before this week.');
    expect(third('volume_spread')).toBe('bordesak played 4 artists at 3 or more times their usual rate this week, including A.');
    expect(third('volume_vs_normal')).toBe('bordesak played Boards of Canada 41 times this week, at 3 or more times their usual rate.');
    expect(third('album_mode')).toBe("38% of bordesak's plays this week came in runs of 8 or more tracks from one album, the highest share of the last 5 weeks.");
    expect(third('last_week_faded')).toBe("Tycho and 1 other artist from bordesak's top artists last week had few or no plays this week.");
    expect(third('genre_cluster')).toBe('bordesak played 4 jazz artists this week that had been away for months or had few or no plays '
      + 'before this week, led by Wes Montgomery.');
    expect(third('returns')).toBe('bordesak came back to Joe Henderson and 1 other artist this week after months away.');
  });

  it('a discovery line follows the tier: first plays under this name, or the earlier plays', () => {
    const tiered = (tier: Tier, before: number | null): WeekFacts => leading(
      { ...melttWeek(), topArtists: [{ artist: 'Siiga', plays: 12, tier, nameUncertain: false }] },
      sample('discovery', {
        subject: 'Siiga', entities: ['Siiga'],
        quantities: [...(before === null ? [] : [{ value: before, unit: 'plays' as const, entity: 'Siiga' }]),
          { value: 12, unit: 'plays', entity: 'Siiga' }, { value: 1, unit: 'days', entity: 'Siiga' }],
      }),
    );
    const first = tiered('first_under_this_name', null);
    expect(renderLine(first, 'second')).toBe('You played Siiga 12 times this week, the first plays under this name.');
    expect(renderLine(first, 'third')).toBe('bordesak played Siiga 12 times this week, the first plays under this name.');
    const barely = tiered('barely_known', 3);
    expect(renderLine(barely, 'second')).toBe('You played Siiga 12 times this week, after only 3 plays before this week.');
    expect(renderLine(barely, 'third')).toBe('bordesak played Siiga 12 times this week, after only 3 plays before this week.');
    // Equal values merge in the statement builder: 12 before and 12 this week leave one quantity, still the earlier one.
    const same = tiered('barely_known', 12);
    expect(renderLine({ ...same, facts: [{ ...same.facts[0], quantities: same.facts[0].quantities.slice(1) }] }, 'second'))
      .toBe('You played Siiga 12 times this week, after only 12 plays before this week.');
    expect(renderLine(tiered('barely_known', 1), 'second')).toBe('You played Siiga 12 times this week, after only 1 play before this week.');
    for (const wf of [first, barely]) {
      for (const person of ['second', 'third'] as const) expect(renderLine(wf, person)).not.toMatch(/\bnew\b|first time/i);
    }
  });

  it('a discovery outside the top artists makes no claim about its history', () => {
    const line = renderLine(leading(melttWeek(), SAMPLES.discovery.fact), 'second');
    expect(line).toBe('You played Siiga this week.');
  });

  it('narrow breadth and a single return have their own wording', () => {
    const base = melttWeek();
    const narrow = sample('breadth', {
      quantities: [{ value: 2, unit: 'artists' }, { value: 10, unit: 'plays' }, { value: 6, unit: 'artists' }, { value: 12, unit: 'weeks' }],
    });
    expect(renderLine(leading(base, narrow), 'second')).toBe('You played only 2 artists 10 or more times this week, against a usual 6.');
    // A narrow week names its artists, each with plays tied to them; the line reads the untied threshold and stays narrow.
    const named = sample('breadth', {
      entities: ['Combichrist'],
      quantities: [{ value: 1, unit: 'artists' }, { value: 10, unit: 'plays' }, { value: 12, unit: 'plays', entity: 'Combichrist' },
        { value: 4, unit: 'artists' }, { value: 12, unit: 'weeks' }],
    });
    expect(renderLine(leading(base, named), 'second')).toBe('You played only 1 artist 10 or more times this week, against a usual 4.');
    const one = sample('returns', {
      subject: 'Joe Henderson', entities: ['Joe Henderson'],
      quantities: [{ value: 6, unit: 'plays', entity: 'Joe Henderson' }, { value: 12, unit: 'months', entity: 'Joe Henderson' }],
    });
    expect(renderLine(leading(base, one), 'second')).toBe('You came back to Joe Henderson this week after months away.');
    const partial = sample('single_listen', {
      subject: 'Boards of Canada', entities: ['Boards of Canada', 'Inferno'], dates: [SAT_MAY_30],
      quantities: [{ value: 9, unit: 'tracks', entity: 'Inferno' }, { value: 11, unit: 'tracks', entity: 'Inferno' }],
    });
    expect(renderLine(leading(base, partial), 'second')).toBe('You played 9 tracks from Inferno by Boards of Canada on Sat May 30.');
  });

  it('every fixture fact renders with its own template in both persons', () => {
    for (const n of FIXTURES) {
      const wf = buildWeekFacts(loadFixture(n));
      for (const f of wf.facts) {
        for (const person of ['second', 'third'] as const) {
          const line = renderLine(leading(wf, f), person);
          expectPlainLine(line);
          expect(line).not.toMatch(/^(?:A quiet week|Nothing stood out|No plays recorded)/);
          if (f.subject !== null && f.kind !== 'genre_cluster') expect(line).toContain(f.subject);
        }
      }
    }
  });

  it('a fact missing the values its template needs falls back to the volume sentence', () => {
    const wf = leading(melttWeek(), sample('repeat_album', { subject: 'Meltt', entities: ['Eternal Embers', 'Meltt'] }));
    expect(renderLine(wf, 'second')).toBe('Nothing stood out this week: 18 plays, led by Meltt.');
  });

  it('quiet lines by volume', () => {
    const base = buildWeekFacts(makeInputs({ username: 'bordesak', scrobbles: plays('Nils Frahm', 30, MON, '') }));
    expect(base.quiet).toBe(true);
    const quiet: WeekFacts = { ...base, priorAverage: 50 }; // 30 is under 80% of 50
    expect(renderLine(quiet, 'second')).toBe('A quiet week: 30 plays. Nils Frahm came up most.');
    expect(renderLine(quiet, 'third')).toBe('A quiet week for bordesak: 30 plays. Nils Frahm came up most.');
    const busy: WeekFacts = { ...base, plays: { ...base.plays, deduped: 412 }, priorAverage: 400 };
    expect(renderLine(busy, 'second')).toBe('Nothing stood out this week: 412 plays, led by Nils Frahm.');
    expect(renderLine(busy, 'third')).toBe('Nothing stood out for bordesak this week: 412 plays, led by Nils Frahm.');
    // Without a baseline there is no average to call the week quiet against.
    expect(renderLine(base, 'second')).toBe('Nothing stood out this week: 30 plays, led by Nils Frahm.');
    // A quiet week with a fact below the threshold still gets the quiet sentence.
    expect(renderLine({ ...quiet, facts: [{ ...SAMPLES.volume.fact, salience: 35 }] }, 'second'))
      .toBe('A quiet week: 30 plays. Nils Frahm came up most.');
  });

  it('a week with no plays says so', () => {
    const wf = buildWeekFacts(makeInputs({ username: 'bordesak' }));
    expect(renderLine(wf, 'second')).toBe('No plays recorded this week.');
    expect(renderLine(wf, 'third')).toBe('No plays recorded for bordesak this week.');
  });

  it('one play is singular', () => {
    const wf = buildWeekFacts(makeInputs({ scrobbles: plays('Nils Frahm', 1, MON, '') }));
    expect(renderLine(wf, 'second')).toBe('Nothing stood out this week: 1 play, led by Nils Frahm.');
  });
});
