// ABOUTME: Builds a fact's statement together with the names, numbers and days it states.
// ABOUTME: Every value enters the sentence through the builder, so entities, quantities and dates match the text.

import type { AlbumRef, Fact, Quantity, Unit } from './types';
import { dayLabel } from './window';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export type Grounded = Pick<Fact, 'statement' | 'entities' | 'albums' | 'quantities' | 'dates'>;

/**
 * Appends text piece by piece. `name`, `album`, `number`, `word` and `day` both write their value and record it,
 * which is what the guard (spec section 3) relies on: nothing in a statement is untyped.
 */
export class StatementBuilder {
  private text = '';
  private readonly entities: string[] = [];
  private readonly albums: AlbumRef[] = [];
  private readonly quantities: Quantity[] = [];
  private readonly dates: number[] = [];

  constructor(private readonly timezone: string | null) {}

  /** Plain words. Must not contain names, digits or day labels. */
  add(text: string): this {
    this.text += text;
    return this;
  }

  /** An artist name. Album names go through `album`, so every album is recorded with its artist. */
  name(name: string): this {
    this.text += name;
    if (!this.entities.includes(name)) this.entities.push(name);
    return this;
  }

  /** An album's name, written and recorded like `name`, and recorded once more as an album of `artist`. */
  album(artist: string, album: string): this {
    this.name(album);
    if (!this.albums.some((a) => a.artist === artist && a.album === album)) this.albums.push({ artist, album });
    return this;
  }

  /** A number written in digits. */
  number(value: number, unit: Unit, entity?: string): this {
    this.text += String(value);
    return this.quantity(value, unit, entity);
  }

  /** A number written as a word up to twelve ('Four' with `capital`), in digits above that. */
  word(value: number, unit: Unit, options: { entity?: string; capital?: boolean } = {}): this {
    const word = NUMBER_WORDS[value] ?? String(value);
    this.text += options.capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    return this.quantity(value, unit, options.entity);
  }

  /** A day label ('Mon Jun 15') in the owner's timezone; `ts` is any moment in that day. */
  day(ts: number): this {
    this.text += dayLabel(ts, this.timezone);
    if (!this.dates.includes(ts)) this.dates.push(ts);
    return this;
  }

  /** Writes `items` separated by `separator`, each through `write`, which is handed this builder. */
  each<T>(items: T[], separator: string, write: (b: this, item: T) => void): this {
    items.forEach((item, i) => {
      if (i > 0) this.add(separator);
      write(this, item);
    });
    return this;
  }

  build(): Grounded {
    return {
      statement: this.text,
      entities: [...this.entities],
      albums: this.albums.map((a) => ({ ...a })),
      quantities: [...this.quantities],
      dates: [...this.dates],
    };
  }

  private quantity(value: number, unit: Unit, entity?: string): this {
    const seen = this.quantities.some((q) => q.value === value && q.unit === unit && q.entity === entity);
    if (!seen) this.quantities.push(entity === undefined ? { value, unit } : { value, unit, entity });
    return this;
  }
}
