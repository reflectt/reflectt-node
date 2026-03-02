# Content Preflight Checklist

*Every piece of content must pass this checklist before publishing. No exceptions.*

Created in response to launch day failures (2026-02-27). Three preventable mistakes shipped because we had no pre-publish gate.

---

## The Three Failures This Prevents

1. **Parroting** — Reused Ryan's exact words as headlines instead of writing original copy. He called it out: "seems like you all just used my words instead of your own."
2. **Privacy** — Included a real person's name (Jake) in a published article without checking. Required live API edit to scrub.
3. **Dead links** — Primary CTAs pointed to app.reflectt.ai, which is a bare auth wall. Took PR #36 to fix.

---

## Before Publishing: Run Every Item

### ✍️ Originality
- [ ] **No verbatim reuse of stakeholder language.** If Ryan (or anyone) said something in chat, rephrase it. Use it as direction, not copy.
- [ ] **Read it out loud.** Does it sound like Echo, or does it sound like a summary of someone else's words?
- [ ] **Diff against source material.** If you're working from a brief, compare — if any sentence is >80% identical, rewrite it.

### 🔒 Privacy & Sensitivity
- [ ] **No real names** unless the person explicitly approved it. Use "[a user]" or "[an early tester]" instead.
- [ ] **No internal details** — task IDs, agent names, channel names, private metrics. None of that in public content.
- [ ] **Search for proper nouns.** Ctrl+F every draft for names, companies, handles that shouldn't be there.

### 🔗 Links & CTAs
- [ ] **Click every link.** Not "I think this goes to the right place" — actually click it and verify the destination works.
- [ ] **Test CTAs in an incognito/logged-out browser.** Auth walls, blank pages, and redirects are invisible when you're already logged in.
- [ ] **Primary CTA goes to a working page.** If the destination isn't ready, don't link to it. Link to what works (/bootstrap, GitHub, docs).

### 📋 Quality Gate
- [ ] **Who is this for?** Write the audience in one sentence at the top of the draft. If you can't, don't publish.
- [ ] **What should they do after reading?** One clear action. If there isn't one, this content might not need to exist.
- [ ] **Would I be embarrassed if Ryan reads this in 5 minutes?** If yes, it's not ready.

---

## How to Use This

1. Draft content.
2. Run checklist — every item, no skipping.
3. Fix anything that fails.
4. Post to #shipping with the draft + checklist confirmation.
5. If a reviewer or stakeholder catches something this checklist should have caught, **add it to the checklist.**

This is a living doc. The goal isn't bureaucracy — it's catching the obvious stuff before it ships.

---

*Last updated: 2026-02-28 by Echo*
