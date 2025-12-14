# Homepage Redesign Plan

## Current State Analysis

The current homepage at `listentomore.com` consists of:
1. **Greeting** - "Happy {Day}, friend!" with a random AI-generated music fact
2. **Album search** - Simple search form
3. **User listens feed** - Shows what registered users are listening to (progressive loading)
4. **Minimal signup CTA** - One line: "Want your own user page? Sign up with Last.fm now!"

### Problems with Current Design

| Issue | Impact |
|-------|--------|
| No clear value proposition | Visitors don't understand what the product does in 5 seconds |
| Buried signup CTA | Low conversion - easy to miss the single-line prompt |
| Feature discovery is poor | Users don't know about insights, recommendations, Discord bot, etc. |
| No social proof | No indication of community size or user testimonials |
| Mobile experience unclear | Content-heavy without clear visual hierarchy |

---

## Recommendation: Conversion-Focused Homepage

### Design Philosophy

**Goal:** Convert visitors into registered users while maintaining the friendly, music-lover personality.

**Approach:** Hero-first design with clear value proposition, followed by feature highlights and social proof, ending with the existing community feed.

---

## Proposed Layout

### Section 1: Hero (Above the Fold)

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]                              [Sign In] [Get Started]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     Discover your music story.                              │
│                                                             │
│     AI-powered insights into your listening habits.         │
│     See your stats. Get recommendations. Share with friends.│
│                                                             │
│     [Get Started with Last.fm →]   [See an example profile] │
│                                                             │
│     ┌─────────────────────────────────────────────────┐     │
│     │  [Screenshot/mockup of user profile page]       │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key elements:**
- **Headline:** "Discover your music story." (or similar - short, evocative)
- **Subheadline:** Explains the core value in one sentence
- **Primary CTA:** "Get Started with Last.fm" - prominent button
- **Secondary CTA:** "See an example profile" - links to a public user profile (e.g., `/u/bordesak`)
- **Visual:** Screenshot or stylized mockup of the insights/stats page

**Design choices:**
- Keep the friendly tone but lead with value, not greeting
- The greeting can move to a smaller element or appear after login
- Hero should work on mobile (stacked layout)

---

### Section 2: Feature Highlights (3-4 cards)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  What you can do with ListenToMore                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ 📊 Stats     │  │ 🎯 Insights  │  │ 💿 Discovery │       │
│  │              │  │              │  │              │       │
│  │ See your top │  │ Weekly AI    │  │ Explore any  │       │
│  │ artists,     │  │ analysis of  │  │ album with   │       │
│  │ albums, and  │  │ your         │  │ summaries &  │       │
│  │ listening    │  │ listening    │  │ streaming    │       │
│  │ trends       │  │ patterns     │  │ links        │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  ┌──────────────┐                                           │
│  │ 🤖 Discord   │                                           │
│  │              │                                           │
│  │ Share albums │                                           │
│  │ in Discord   │                                           │
│  │ with /album  │                                           │
│  └──────────────┘                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Features to highlight:**
1. **Stats** - Top artists, albums, recent listening history
2. **Insights** - AI-powered weekly analysis with personalized recommendations
3. **Album Discovery** - Search any album, get AI summaries, streaming links
4. **Discord Bot** - Share albums in Discord servers

**Design choices:**
- Use icons/emojis for visual interest
- Keep descriptions to 2-3 lines max
- Cards should link to relevant pages (e.g., Stats → example profile, Discovery → album search)

---

### Section 3: Social Proof / Community

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Join [X] music lovers already tracking their listening     │
│                                                             │
│  "Quote from a user or testimonial"                         │
│                     — @username                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Options (pick based on what data is available):**
- User count ("Join 150+ music lovers...")
- Testimonial quote (if you have any)
- Skip this section if numbers are too small - can add later

**Design choice:** If user count is <100, consider omitting the number and just saying "Join music lovers who..."

---

### Section 4: Album Search (Existing)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Explore any album                                          │
│                                                             │
│  ┌────────────────────────────────┐ [Search]                │
│  │ Search for an album...         │                         │
│  └────────────────────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Keep this section** - it provides immediate value without requiring signup.

---

### Section 5: Community Feed (Existing, Modified)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  What the community is listening to                         │
│  Last updated 2:30 PM                                       │
│                                                             │
│  [Existing user listens grid]                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Want to see your music here?                        │    │
│  │ [Get Started with Last.fm →]                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Changes:**
- Rename from "What users are listening to" → "What the community is listening to"
- Add a more prominent CTA box at the end of the feed
- Keep the existing progressive loading functionality

---

### Section 6: Final CTA (Footer area)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Ready to discover your music story?                        │
│                                                             │
│  [Get Started with Last.fm →]                               │
│                                                             │
│  Free forever. No spam. Just music.                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Purpose:** Catch users who scrolled through everything but didn't convert yet.

---

## Logged-In User Experience

For authenticated users, the homepage should feel different:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Happy Friday, [username]!                                  │
│                                                             │
│  [Random music fact]                                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Your Stats → │  │ Insights →   │  │ Recs →       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  [Album search]                                             │
│                                                             │
│  [Community feed - without signup CTAs]                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Changes for logged-in users:**
- Personalized greeting with username
- Quick links to their own profile pages
- Remove all signup CTAs
- Keep the random fact (it's charming)
- Keep community feed (social/discovery value)

---

## Implementation Approach

### Phase 1: Hero + Feature Cards (High Impact)
1. Create new hero section with value proposition
2. Add feature highlight cards
3. Move greeting to logged-in experience only
4. Keep existing album search and community feed

### Phase 2: Polish + Social Proof
1. Add user count or testimonials (if available)
2. Add final CTA section
3. Improve mobile responsiveness

### Phase 3: Logged-In Experience
1. Differentiate homepage for authenticated users
2. Add quick-access cards to user's own pages

---

## Design Decisions Made

| Decision | Rationale |
|----------|-----------|
| Lead with value prop, not greeting | First-time visitors need to understand the product before feeling welcomed |
| Keep album search accessible | Provides immediate value without requiring signup - good for SEO and trust |
| Feature cards over long text | Scannable, mobile-friendly, highlights breadth of product |
| Multiple CTAs throughout page | Different users convert at different scroll depths |
| Differentiate logged-in experience | Returning users want quick access, not marketing |

---

## Open Questions — RESOLVED

1. **Hero image/visual:** ✅ Start with illustration or ASCII art (no screenshot needed)

2. **User count:** ✅ Omit - too few users to mention

3. **Testimonials:** ✅ None available - skip social proof section for now

4. **Example profile:** ✅ Use `/u/bordesak` as the example

5. **Mobile priority:** ✅ Mobile-first design required

6. **A/B testing:** Skipped for now

---

## Alternatives Considered

### Alternative A: Minimal Hero
Just add a one-liner value prop above the current design. Lower effort but lower impact.

**Rejected because:** Doesn't solve the feature discovery problem.

### Alternative B: Full Marketing Site
Separate landing page from the app, with extensive copy and testimonials.

**Rejected because:** Overkill for current stage. Can evolve to this later if needed.

### Alternative C: Video Demo
Hero with embedded video showing the product in action.

**Rejected because:** Higher production cost, slower page load. Consider for future.

---

## Next Steps

1. Review this plan and answer open questions
2. Decide on Phase 1 scope
3. Create/source hero visual
4. Implement hero + feature cards
5. Test on mobile
6. Deploy and monitor signup conversion

---

## Appendix: Copy Suggestions

### Headlines (pick one)
- "Discover your music story."
- "Your listening habits, visualized."
- "See what your music says about you."
- "Music stats that actually matter."

### Subheadlines
- "AI-powered insights into your listening habits. See your stats. Get recommendations. Share with friends."
- "Connect your Last.fm account to unlock personalized stats, AI insights, and album recommendations."
- "Track your listening, discover new music, and share your taste with the world."

### CTA Button Text
- "Get Started with Last.fm" (recommended - clear about the auth method)
- "Connect Last.fm"
- "Start Free"
- "See Your Stats"
