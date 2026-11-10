// ABOUTME: Tests for scripts/insights-rubric.ts, the insights eval's banned-word and construction check: whole-word
// ABOUTME: matching, the em dash, negation contrast, a clean round 2 note, and masking the week's names first.

import { describe, it, expect } from 'vitest';
import { checkNoteRubric, checkRubric, maskNames } from '../../../scripts/insights-rubric';

// Round 2, May 24, run 1: a note the owner read as clean.
const ROUND2_MAY24 =
  'Four jazz names came back to you this week: Wes Montgomery with 8 plays, Wayne Shorter and Joe Henderson with 6 each, '
  + 'and Grant Green with 5, and Joe Henderson had been gone for 12+ months. The Cannonball Adderley Quintet also returned '
  + 'after a year away, alongside whole runs of Tea for the Tillerman and Tons Of Sobs. Boards of Canada took over Friday '
  + 'with 41 plays, including Inferno start to finish.';

describe('checkRubric', () => {
  it('flags taste and sound words as whole words only', () => {
    expect(checkRubric('Your best week in months.')).toEqual(['best']);
    expect(checkRubric('Bestival and Greatest Hits got 9 plays.')).toEqual([]);
    expect(checkRubric('A Great run, a gorgeous record and a lush one.')).toEqual(['great', 'gorgeous', 'lush']);
    expect(checkRubric('It sounds like rain. That one is for me.')).toEqual(['sounds like', 'for me']);
    expect(checkRubric("I'd call it a week that still holds up and says a lot.")).toEqual([
      "I'd",
      'still holds up',
      'says a lot',
    ]);
    expect(checkRubric('You clearly must have loved it.')).toEqual(['clearly', 'must have']);
  });

  it('reads a curly apostrophe as a straight one', () => {
    expect(checkRubric('I’d say so.')).toEqual(["I'd"]);
  });

  it('flags an em dash and "not X, it\'s Y"', () => {
    expect(checkRubric('Boards of Canada — 41 plays.')).toEqual(['em dash']);
    expect(checkRubric("It's not a phase, it's a habit.")).toEqual(['negation contrast']);
    expect(checkRubric('That’s not a detour, that’s the week.')).toEqual(['negation contrast']);
  });

  it('flags "not X but Y" and "less like X, more like Y"', () => {
    expect(checkRubric('You played not one album but three.')).toEqual(['negation contrast']);
    expect(checkRubric('Less like a binge, more like a habit.')).toEqual(['negation contrast']);
  });

  it('names each banned item once', () => {
    expect(checkRubric('Best of all, the best run — and it is not this — the other.')).toEqual([
      'best',
      'em dash',
      'negation contrast',
    ]);
  });

  it('passes the round 2 May 24 note', () => {
    expect(checkRubric(ROUND2_MAY24)).toEqual([]);
  });
});

describe('maskNames', () => {
  it('replaces whole names, longest first, and leaves partial matches alone', () => {
    expect(maskNames('Great White and Great got 8 plays.', ['Great', 'Great White'])).toBe('Name and Name got 8 plays.');
    expect(maskNames('Greatest Hits and Great Whites.', ['Great White'])).toBe('Greatest Hits and Great Whites.');
  });

  it('matches names with regex-special characters and either apostrophe', () => {
    expect(maskNames('AC/DC (Live) had 3 plays; Bear’s Den had 2.', ['AC/DC (Live)', "Bear's Den"]))
      .toBe('Name had 3 plays; Name had 2.');
  });
});

describe('checkNoteRubric', () => {
  it('does not flag a banned word inside a name', () => {
    expect(checkNoteRubric('Great White got 8 plays.', ['Great White'])).toEqual([]);
  });

  it('still flags the word outside the name', () => {
    expect(checkNoteRubric('Great White was great.', ['Great White'])).toEqual(['great']);
  });

  it('checks the em dash and negation contrast on the original text', () => {
    expect(checkNoteRubric('Not Waving — 4 plays.', ['Not Waving'])).toEqual(['em dash', 'negation contrast']);
  });

  it('is checkRubric when no names are given', () => {
    expect(checkNoteRubric('Your best week in months.', [])).toEqual(checkRubric('Your best week in months.'));
  });
});
