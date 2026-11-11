// ABOUTME: Tests for the copy rubric: announcing openers, the quiet negation-contrast variants, and every overused
// ABOUTME: word and phrase from avoid-ai-patterns.md in any inflection, with names masked and "a quiet week" allowed.

import { describe, it, expect } from 'vitest';
import { checkCopyRubric } from '../src';

/** One row: the copy, the names to mask in it, and the overused entry it must flag (null: it must pass clean). */
type Row = [text: string, names: string[], entry: string | null];

/** Each family's table: every entry flagged at least once, inflections included, then look-alikes that must pass. */
const FAMILIES: Record<string, Row[]> = {
  verbs: [
    ['They delved into the archive.', [], 'delve'],
    ['The liner notes underscore the date.', [], 'underscore'],
    ['The live take highlights the drums.', [], 'highlight'],
    ['The sessions were showcasing new songs.', [], 'showcase'],
    ['They leveraged a borrowed desk.', [], 'leverage'],
    ['The band utilized a church.', [], 'utilize'],
    ['The label facilitated the tour.', [], 'facilitate'],
    ['The club fostered a scene.', [], 'foster'],
    ['They navigated a lawsuit.', [], 'navigate'],
    ['It garnered airplay in 1971.', [], 'garner'],
    ['They crafted it in a week.', [], 'craft'],
    ['They harnessed tape loops.', [], 'harness'],
    ['The album boasts 12 songs.', [], 'boast'],
    ['It surpasses their debut in sales.', [], 'surpass'],
    ['A spacecraft is on the cover.', [], null],
    ['A boastful sleeve note sat inside.', [], null],
    ['The navigator on the cover is the drummer.', [], null],
    ['Highlights had 9 plays.', ['Highlights'], null],
    ['They marked the tape boxes with a highlighter.', [], null],
  ],
  adjectives: [
    ['An intricately layered mix.', [], 'intricate'],
    ['A meticulous edit.', [], 'meticulous'],
    ['It sold swiftly.', [], 'swift'],
    ['An adept bassist.', [], 'adept'],
    ['A liminal record.', [], 'liminal'],
    ['A spectral vocal.', [], 'spectral'],
    ['A crucial session.', [], 'crucial'],
    ['A pivotal tour.', [], 'pivotal'],
    ['A robust mix.', [], 'robust'],
    ['It flows seamlessly.', [], 'seamless'],
    ['A transformative year.', [], 'transformative'],
    ['A groundbreaking single.', [], 'groundbreaking'],
    ['Cutting edge gear for 1971.', [], 'cutting-edge'],
    ['A nuanced take.', [], 'nuanced'],
    ['A multifaceted band.', [], 'multifaceted'],
    ['A sharper mix than the demo.', [], 'sharp'],
    ['The load-bearing song.', [], 'load-bearing'],
    ['Taylor Swift had 8 plays.', ['Taylor Swift'], null],
    ['Sharpe played bass on it.', [], null],
    ['They cut it in the cutting room.', [], null],
  ],
  nouns: [
    ['A tapestry of guitars.', [], 'tapestry'],
    ['Tapestries hang in the studio.', [], 'tapestry'],
    ['They journeyed to Memphis.', [], 'journey'],
    ['It echoes their debut.', [], 'echo'],
    ['A whispered vocal.', [], 'whisper'],
    ['It sits in their shadow.', [], 'shadow'],
    ['The ghosts of the old studio.', [], 'ghost'],
    ['The landscape of 1971 radio.', [], 'landscape'],
    ['The realm of prog.', [], 'realm'],
    ['A new paradigm for the band.', [], 'paradigm'],
    ['The label ecosystem.', [], 'ecosystem'],
    ['The synergies of two drummers.', [], 'synergy'],
    ['The seams between the takes.', [], 'seam'],
    ['The throughline is the drummer.', [], 'throughline'],
    ['It was shaped by the tour.', [], 'shape'],
    ['Echo & the Bunnymen had 4 plays.', ['Echo & the Bunnymen'], null],
    ['Journey came up most, with 6 plays.', ['Journey'], null],
    ['A seamstress sewed the sleeve.', [], null],
    ['A shapeshifter is on the cover.', [], null],
    ['A seamer bowled at the launch.', [], null],
    ['A whisperer is credited on the sleeve.', [], null],
  ],
  'atmosphere and filler': [
    ['A record of quiet confidence.', [], 'quiet'],
    ['The amp hummed through every take.', [], 'hum'],
    ['A humming organ.', [], 'humming'],
    ['Strings woven through the mix.', [], 'woven'],
    ['The guitars weave around the vocal.', [], 'weave'],
    ['They wove guitars through the mix.', [], 'weave'],
    ['A deeply personal record.', [], 'deeply'],
    ['It fundamentally changed the band.', [], 'fundamentally'],
    ['It was remarkably fast.', [], 'remarkably'],
    ['It was genuinely loud.', [], 'genuinely'],
    ['It was truly loud.', [], 'truly'],
    ['It was incredibly loud.', [], 'incredibly'],
    ['It is arguably their loudest.', [], 'arguably'],
    ['A humble demo.', [], null],
    ['The amp was a Hummer-sized stack.', [], null],
    ['The Human League had 6 plays.', [], null],
    ['Truly Madly Deeply had 2 plays.', ['Truly Madly Deeply'], null],
  ],
  phrases: [
    ["It's worth noting the date.", [], "it's worth noting"],
    ['It bears mentioning that it sold out.', [], 'it bears mentioning'],
    ['As mentioned earlier, the album was recorded in a barn.', [], 'as mentioned'],
    ['As noted above, it was cut in a barn.', [], 'as mentioned'],
    ["In today's streaming world, it sold.", [], "in today's world"],
    ['What stood out was the barn.', [], 'what stood out'],
    ['The barn jumped out at me.', [], 'jumped out at me'],
    ['The barn caught my attention.', [], 'caught my attention'],
    ['The barn is what I keep coming back to.', [], 'what I keep coming back to'],
    ['I keep thinking about the barn.', [], 'I keep thinking about'],
    ['It was a demo in disguise.', [], 'in disguise'],
    ['A demo dressed up as an album.', [], 'dressed up as'],
    ['The same song wearing different clothes.', [], 'wearing different clothes'],
    ['Notably, it sold out.', [], 'notably'],
    ['Interestingly, it sold out.', [], 'interestingly'],
    ['Importantly, it sold out.', [], 'importantly'],
    ['Its reach cannot be overstated.', [], 'cannot be overstated'],
    ['It is a testament to the band.', [], 'a testament to'],
    ['It paved the way for punk.', [], 'paving the way'],
    ['It unlocks the potential of tape.', [], 'unlock the potential'],
    ['At the end of the day, it sold.', [], 'at the end of the day'],
    ['In conclusion, it sold.', [], 'in conclusion'],
    ['To sum up, it sold.', [], 'to sum up'],
    ['In summary, it sold.', [], 'in summary'],
    ['The barn served as a studio.', [], 'serves as'],
    ['It stands as their longest record.', [], 'stands as'],
    ['It stands at 41 minutes.', [], null],
    ['They summed it up in one take.', [], null],
    ['The day ended at the barn.', [], null],
    ['It was mentioned in a 1971 interview.', [], null],
  ],
};

describe('checkCopyRubric', () => {
  it('flags announcing openers', () => {
    for (const text of [
      "Here's the fact: Inferno was cut in a barn.",
      'Fun fact: Inferno was cut in a barn.',
      'Did you know Inferno was cut in a barn?',
    ]) {
      expect(checkCopyRubric(text, ['Inferno'])).toContain('announcing');
    }
  });

  it('flags every announcing opener at the start of a sentence, and nowhere else', () => {
    const rows: Array<[string, string[], boolean]> = [
      ['Here is the fact: it was cut in a barn.', [], true],
      ['It sold out. The best part was the barn.', [], true],
      ["But here's the thing: it was cut in a barn.", [], true],
      ['They recorded here in 1971.', [], false],
      ['It was fun, in fact.', [], false],
      ["Here's Little Richard had 5 plays.", ["Here's Little Richard"], false],
      ['Fun facts: Inferno was cut in a barn.', ['Inferno'], true],
      ['“Here’s the fact: Inferno was cut in a barn.”', ['Inferno'], true],
      ['"Here\'s the fact: Inferno was cut in a barn."', ['Inferno'], true],
      ['It sold out. “Did you know it was cut in a barn?”', [], true],
      ['It was cut in a barn, and here’s the kicker: in a week.', [], true],
      ['The idea is simple: cut it live.', [], true],
      ['My take is this: cut it live.', [], true],
      ['I think about it like this: one take.', [], true],
      ['The mix is simple.', [], false],
      ['Track list: 9 songs, 41 minutes.', [], false],
      ['“Here’s Little Richard” had 5 plays.', ["Here's Little Richard"], false],
    ];
    for (const [text, names, flagged] of rows) {
      expect(checkCopyRubric(text, names).includes('announcing'), text).toBe(flagged);
    }
  });

  it('masks names, so an album called Echoes passes', () => {
    expect(checkCopyRubric('Echoes was recorded over two weeks in 1971.', ['Echoes'])).toEqual([]);
  });

  it('flags overused entries in any inflection, shadow and quiet included', () => {
    const showcased = checkCopyRubric('The sessions showcased a pivotal shift.', []);
    expect(showcased).toContain('overused:showcase');
    expect(showcased).toContain('overused:pivotal');
    expect(checkCopyRubric('It sits in the shadow of their debut.', [])).toContain('overused:shadow');
    expect(checkCopyRubric('A record of quiet confidence.', [])).toContain('overused:quiet');
  });

  for (const [family, rows] of Object.entries(FAMILIES)) {
    it(`flags every overused ${family} entry and passes look-alikes`, () => {
      for (const [text, names, entry] of rows) {
        if (entry === null) expect(checkCopyRubric(text, names), text).toEqual([]);
        else expect(checkCopyRubric(text, names), text).toContain(`overused:${entry}`);
      }
    });
  }

  it('allows the literal "a quiet week" and nothing else with quiet', () => {
    expect(checkCopyRubric('A quiet week: 12 plays. Meltt came up most.', ['Meltt'])).toEqual([]);
    expect(checkCopyRubric('A quiet week of quietly growing plays.', [])).toContain('overused:quiet');
    for (const text of [
      'A quiet weekend: 12 plays.',
      'The quiet week had 12 plays.',
      'A quieter week: 12 plays.',
      'It was quiet: 12 plays.',
    ]) {
      expect(checkCopyRubric(text, []), text).toContain('overused:quiet');
    }
  });

  it('flags the quiet negation-contrast variants', () => {
    for (const text of [
      'It was cut live rather than overdubbed.',
      'They used tape instead of a computer.',
      'It was not only fast but loud.',
      'It was less about speed than volume.',
    ]) {
      expect(checkCopyRubric(text, []), text).toContain('negation contrast');
    }
    for (const text of ['They would rather tour.', 'They toured instead.', 'Only 12 plays, less than last week.']) {
      expect(checkCopyRubric(text, []), text).not.toContain('negation contrast');
    }
  });

  it('flags the copy-only negation contrasts, and passes plain facts', () => {
    const rows: Array<[string, string | null]> = [
      ["It isn't a demo. It's the released take.", 'negation contrast'],
      ['That’s not a detour. That’s the week.', 'negation contrast'],
      ['It was not about speed. It was about tape.', 'negation contrast'],
      ['They cut it live not because of budget, but because of the room.', 'negation contrast'],
      ['They cut it live not because of budget. The room was free.', 'negation contrast'],
      ["It isn't music. It's magic.", 'negation contrast'],
      ["It isn't tape. It's digital.", 'negation contrast'],
      ["It isn't live. It's overdubbed.", 'negation contrast'],
      ["It wasn't released until 1972. It was recorded in 1970.", 'negation contrast'],
      ['It was not released in 1997. It came out in 1998.', null],
      ['It was cut in a barn. It sold 2 million copies.', null],
    ];
    for (const [text, item] of rows) {
      const hits = checkCopyRubric(text, []);
      if (item === null) expect(hits, text).toEqual([]);
      else expect(hits, text).toContain(item);
    }
  });

  it('flags a rhetorical question only in copy without quotation marks', () => {
    // An apostrophe between two letters is not a quotation mark. Any other quote, a trailing possessive included,
    // skips the check, so a rhetorical question next to a quote is an accepted miss.
    const rows: Array<[string, string | null]> = [
      ['Who produced it? Nigel Godrich did, at Ocean Way.', 'rhetorical question'],
      ['The result? A barn in Kent.', 'rhetorical question'],
      ['Why? The tape ran out.', 'rhetorical question'],
      ["Don't ask. Who produced it? Nigel Godrich did.", 'rhetorical question'],
      ["O'Brien's band? It was a trio.", 'rhetorical question'],
      ['The sample asks “Why?” The drums enter after it.', null],
      ['The opening sample: “Are you ready?” A choir enters after it.', null],
      ['The sample asks "Why?" The drums enter after it.', null],
      ["The sample asks ‘Who’s there?’ The drums enter after it.", null],
      ['The opening sample: ‘Are you ready? Here we go!’ A choir enters after it.', null],
      ["The opening sample: 'Are you ready? Here we go!' A choir enters after it.", null],
      ['The opening sample: “Are you ready?\nHere we go!” A choir enters after it.', null],
      ["The sample: 'Don't stop? O'Brien's not here!' A choir enters after it.", null],
      ["The bands' van carried the tape. The sample: 'Listen closely. Why?' The drums enter after it.", null],
      ["The sleeve reads 'mono'. Who produced it? The sample asks 'Why?'", null],
      ['The sleeve reads "mono". Who produced it? The sample asks "Why?"', null],
      ['The sleeve reads ‘mono’. Who produced it? The sample asks ‘Why?’', null],
      ["The sleeve reads 'mono.' Who produced it? Nigel Godrich did.", null],
      ["The sleeve reads 'mono. Who produced it? Nigel Godrich did.", null],
      ["The bands' van? It was a Transit.", null],
      ['The sleeve reads «mono». Who produced it? Nigel Godrich did.', null],
      ['The sleeve reads ‹mono›. Who produced it? Nigel Godrich did.', null],
      ['The sleeve reads „mono“. Who produced it? Nigel Godrich did.', null],
      ['The sleeve reads „mono. Who produced it? Nigel Godrich did.', null],
      ['The sleeve reads ‚mono. Who produced it? Nigel Godrich did.', null],
      ['Who Is William Onyeabor? had 4 plays.', null],
      // Any Unicode quotation mark counts: CJK corner brackets and the fullwidth quote too.
      ['The opening sample: 「Are you ready? Here we go!」 A choir enters after it.', null],
      ['The opening sample: 『Are you ready? Here we go!』 A choir enters after it.', null],
      ['The opening sample: ＂Are you ready? Here we go!＂ A choir enters after it.', null],
      ['The sleeve reads 「mono」. Who produced it? Nigel Godrich did.', null],
    ];
    for (const [text, item] of rows) {
      const hits = checkCopyRubric(text, text.startsWith('Who Is') ? ['Who Is William Onyeabor?'] : []);
      if (item === null) expect(hits, text).toEqual([]);
      else expect(hits, text).toContain(item);
    }
  });

  it('reads a musical key as a key, and "sharp" anywhere else as the overused adjective', () => {
    const rows: Array<[string, boolean]> = [
      ['It is in C sharp minor.', false],
      ['The riff sits in F-sharp minor.', false],
      ['A song in B flat, cut in a barn.', false],
      ['It moves from A-sharp to G sharp.', false],
      ['It is in A sharp.', false],
      ['A sharp minor intro.', false],
      ['The note was A sharp.', false],
      ['The song ends on A sharp.', false],
      ['It changes from G sharp to A sharp.', false],
      ['In A sharp, the band recorded the song.', false],
      ['It moves through G, A sharp and B.', false],
      ['a sharp essay on the band.', true],
      ['A sharp essay on the band.', true],
      ['A sharper mix than the demo.', true],
    ];
    for (const [text, flagged] of rows) {
      expect(checkCopyRubric(text, []).includes('overused:sharp'), text).toBe(flagged);
    }
  });

  it('keeps the note rubric hits first and names negation contrast once', () => {
    expect(checkCopyRubric('Not only the best take — but the loudest.', [])).toEqual([
      'best',
      'em dash',
      'negation contrast',
    ]);
  });
});
