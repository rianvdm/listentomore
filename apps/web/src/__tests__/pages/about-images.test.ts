// ABOUTME: Checks that every About page feature tile has a screenshot in public/images/about.
// ABOUTME: Files come from scripts/about-shots.mjs; the size bounds catch blank or oversized captures.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ABOUT_FEATURES } from '../../pages/about';

const IMAGE_DIR = path.join(__dirname, '../../../public/images/about');

describe('About page screenshots', () => {
  it.each(ABOUT_FEATURES.map((f) => f.slug))('%s.webp exists and is 10 KB to 300 KB', (slug) => {
    const file = path.join(IMAGE_DIR, `${slug}.webp`);
    expect(fs.existsSync(file)).toBe(true);
    const { size } = fs.statSync(file);
    expect(size).toBeGreaterThan(10 * 1024);
    expect(size).toBeLessThan(300 * 1024);
  });
});
