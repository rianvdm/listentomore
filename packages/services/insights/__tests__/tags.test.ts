// ABOUTME: Tests for Last.fm tag cleaning and genre buckets.
// ABOUTME: Lists come from the step0 build.py reference (spec section 2, "Left to the builder").

import { BROAD_TAGS, bucketOf, cleanTags } from '../src';

it('cleanTags lower-cases, drops noise tags and tags with digits, and keeps the first 3', () => {
  expect(cleanTags(['Seen Live', 'Jazz', '60s', 'guitar', 'Hard Bop', 'soul jazz', 'bebop'])).toEqual(['jazz', 'hard bop', 'soul jazz']);
  expect(cleanTags([])).toEqual([]);
  expect(cleanTags(['british', '00s', ' '])).toEqual([]);
  expect(cleanTags(['two tone', 'One Man Band', 'ska', 'someone'])).toEqual(['ska', 'someone']); // whole number words only
});

it('cleanTags drops mood and quality words, but keeps multi-word genres that contain one', () => {
  const moods = ['mellow', 'atmospheric', 'melancholic', 'melancholy', 'dreamy', 'chill', 'chillout', 'relaxing', 'calm', 'sad',
    'happy', 'beautiful', 'epic', 'dark', 'uplifting', 'emotional', 'energetic', 'haunting', 'ethereal', 'moody', 'sexy', 'cool',
    'fun', 'heavy', 'soft', 'loud', 'intense', 'acoustic'];
  for (const mood of moods) expect(cleanTags([mood, 'Mellow', 'shoegaze']), mood).toEqual(['shoegaze']);
  expect(cleanTags(['Dark', 'dark ambient', 'heavy', 'heavy metal', 'soft rock', 'chill house'])).toEqual(['dark ambient', 'heavy metal', 'soft rock']);
});

it('broad tags include the compounds of rock, alternative, indie, pop and electronic', () => {
  for (const tag of ['rock', 'alternative', 'indie', 'pop', 'electronic', 'alternative rock', 'indie rock', 'indie pop', 'pop rock']) {
    expect(BROAD_TAGS.has(tag)).toBe(true);
  }
  expect(BROAD_TAGS.has('jazz')).toBe(false);
});

it('bucketOf takes raw tags and returns the bucket of the first top-3 tag that has one', () => {
  expect(bucketOf(['seen live', 'Post-Rock', 'ambient'])).toBe('ambient/modern classical');
  expect(bucketOf(['christian', 'christian rock', 'alternative'])).toBe('worship/christian');
  // build.py's buckets filter only stop tags, so instrument tags such as 'piano' and 'trumpet' still place an artist.
  expect(bucketOf(['trumpet'])).toBe('jazz');
  expect(bucketOf(['80s', 'synthpop'])).toBe('synthwave/80s');
  expect(bucketOf(['britpop', 'madchester', 'baggy', 'rock'])).toBeNull();
  expect(bucketOf([])).toBeNull();
});
