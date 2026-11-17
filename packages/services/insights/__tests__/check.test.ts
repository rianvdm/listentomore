// ABOUTME: Tests for checkNote, the check a model-written note passes before it is shown: its listed names are this
// ABOUTME: week's and appear in the text, and every integer it states is in the prompt view (spec, "The check").

import { buildWeekFacts, checkNote, renderPromptView, weekWindow } from '../src';
import type { WeekFacts } from '../src';
import { NOW, makeInputs, plays, ts } from './helpers';

const MON = ts('2026-11-02T10:00:00');
const WED = ts('2026-11-04T10:00:00');

const week: WeekFacts = buildWeekFacts(makeInputs({
  scrobbles: [...plays('Low', 12, MON, 'Things We Lost in the Fire'), ...plays('Nils Frahm', 6, WED, 'Felt (Special Edition)')],
}));
const view = renderPromptView(week);

describe('checkNote', () => {
  it('passes a note whose names and integers are all in the week', () => {
    const note = 'Low led the week with 12 plays of Things We Lost in the Fire, and Nils Frahm\'s record came in at 6.';
    expect(checkNote({ note, names: ['Low', 'Things We Lost in the Fire', 'Nils Frahm'] }, week, view)).toEqual([]);
  });

  it('passes an album named without its edition suffix', () => {
    expect(week.names).toContain('Felt (Special Edition)');
    expect(week.names).not.toContain('Felt');
    const note = 'Nils Frahm\'s Felt got a full listen on Wednesday.';
    expect(checkNote({ note, names: ['Nils Frahm', 'Felt'] }, week, view)).toEqual([]);
  });

  it('passes a faded artist named only in a fact\'s entities', () => {
    // Old played last week only, so the name reaches wf.names through the last_week_faded fact.
    const lastWeek = buildWeekFacts(makeInputs({
      scrobbles: [...plays('Old', 10, weekWindow(NOW, 1).from + 3600, ''), ...plays('Someone', 30, MON, '')],
    }));
    expect(lastWeek.facts.map((f) => f.kind)).toEqual(['last_week_faded']);
    expect(lastWeek.names).toContain('Old');
    const note = 'Someone took over the week while Old dropped away.';
    expect(checkNote({ note, names: ['Someone', 'Old'] }, lastWeek, renderPromptView(lastWeek))).toEqual([]);
  });

  it('fails a name the week does not hold', () => {
    expect(checkNote({ note: 'Low and Slowdive filled the week.', names: ['Low', 'Slowdive'] }, week, view)).toEqual(['name-unknown']);
  });

  it('fails a listed name missing from the text', () => {
    expect(checkNote({ note: 'Low filled the week.', names: ['Low', 'Nils Frahm'] }, week, view)).toEqual(['name-absent']);
    // Names match whole words, so "Lowell" does not contain "Low".
    expect(checkNote({ note: 'Lowell filled the week.', names: ['Low'] }, week, view)).toEqual(['name-absent']);
  });

  it('fails an integer missing from the prompt view', () => {
    expect(view).not.toContain('1997');
    expect(checkNote({ note: 'Low sounded like 1997 all week.', names: ['Low'] }, week, view)).toEqual(['number']);
    // Numbers written as words are not checked.
    expect(checkNote({ note: 'Low sounded like nineteen ninety-seven.', names: ['Low'] }, week, view)).toEqual([]);
  });

  it('reads thousands separators and percents as integers', () => {
    const wide = 'Week: 1204 plays. 40% of plays came in album runs.';
    expect(checkNote({ note: 'Low had 1,204 plays, 40% of them in album runs.', names: ['Low'] }, week, wide)).toEqual([]);
    expect(checkNote({ note: 'Low had 1,205 plays.', names: ['Low'] }, week, wide)).toEqual(['number']);
    // The view's separators are read the same way.
    expect(checkNote({ note: 'Low had 1204 plays.', names: ['Low'] }, week, 'Week: 1,204 plays.')).toEqual([]);
  });

  it('compares an all-punctuation name by norm, since its match key is empty', () => {
    const bang = buildWeekFacts(makeInputs({ scrobbles: plays('!!!', 8, MON, 'Thr!!!er') }));
    const bangView = renderPromptView(bang);
    expect(bang.names).toContain('!!!');
    expect(checkNote({ note: 'You kept coming back to !!! this week.', names: ['!!!'] }, bang, bangView)).toEqual([]);
    expect(checkNote({ note: 'You kept coming back to one band this week.', names: ['!!!'] }, bang, bangView))
      .toEqual(['name-absent']);
    expect(checkNote({ note: 'You kept coming back to ??? this week.', names: ['???'] }, bang, bangView))
      .toEqual(['name-unknown']);
  });

  it('reports each failure type once, in order', () => {
    expect(checkNote({ note: 'Slowdive and Ride filled the week.', names: ['Slowdive', 'Ride'] }, week, view)).toEqual(['name-unknown']);
    expect(checkNote({ note: 'Low hit 1997 and 1998.', names: ['Nobody', 'Someone'] }, week, view))
      .toEqual(['name-unknown', 'name-absent', 'number']);
  });
});
