// ABOUTME: Tests for scripts/insights-rubric.ts, the insights eval's construction check: em dashes and negation
// ABOUTME: contrast in a week note, with the week's names masked first so a title can't trip either.

import { describe, it, expect } from 'vitest';
import { checkEvalRubric, maskNames } from '../../../scripts/insights-rubric';

describe('checkEvalRubric', () => {
  it('flags an em dash', () => {
    expect(checkEvalRubric('Boards of Canada — 41 plays.', [])).toEqual(['em-dash']);
  });

  it('flags "not X, it\'s Y", "not X but Y" and "less like X, more like Y"', () => {
    expect(checkEvalRubric("It's not a phase, it's a direction.", [])).toEqual(['negation-contrast']);
    expect(checkEvalRubric('That’s not a detour, that’s the week.', [])).toEqual(['negation-contrast']);
    expect(checkEvalRubric('You played not one album but three.', [])).toEqual(['negation-contrast']);
    expect(checkEvalRubric('Less like a binge, more like a habit.', [])).toEqual(['negation-contrast']);
  });

  it('names both, em dash first', () => {
    expect(checkEvalRubric('Not a binge — a habit.', [])).toEqual(['em-dash', 'negation-contrast']);
  });

  it('masks the week\'s names first, so a title cannot trip the check', () => {
    const note = 'Not Waving But Drowning got 12 plays on Tuesday.';
    expect(checkEvalRubric(note, ['Not Waving But Drowning'])).toEqual([]);
    expect(checkEvalRubric(note, [])).toEqual(['negation-contrast']);
  });

  it('passes an opinion that is not a construction', () => {
    expect(checkEvalRubric('Still the one, no argument.', [])).toEqual([]);
  });
});

describe('maskNames', () => {
  it('replaces whole names, longest first, with straight apostrophes', () => {
    expect(maskNames('Great White and Great Lake Swimmers', ['Great', 'Great White'])).toBe('Name and Name Lake Swimmers');
    expect(maskNames('Pe’ahi II on repeat', ["Pe'ahi II"])).toBe('Name on repeat');
  });

  it('matches names as given, case included, and never inside a longer word', () => {
    expect(maskNames('best of Best', ['Best'])).toBe('best of Name');
    expect(maskNames('Bestival', ['Best'])).toBe('Bestival');
  });
});
