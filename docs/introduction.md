---
title: A one-minute introduction
summary: Keep writing ordinary prose. Mark a reason or question when it helps.
section: learn
order: 1
audience: One minute
---

# A one-minute introduction

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose.

Use it while reading, developing or revising an argument: in a reading note, an investigation, or the reasons for a decision. Start with the writing. Add a mark where seeing a question or connection would help.

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
- A neighbourhood library is considering later opening hours. This is an imagined discussion.
- [C] The library should stay open until eight on weekdays.
  - [G] Forty people visited after six at last month's evening event.
    - [O] The count included repeat entries, so fewer than forty people may have visited.
    - [O/] People may have come for the special event, not for ordinary evening opening.
```

The opening prose remains body. One objection questions the attendance count; the other grants it and asks what it tells us about ordinary evenings. Four marked points and three explicit connections make that distinction inspectable. The markup does not decide whether the library should open later.

Paste the note into the [playground](https://cogitatum.onesimos.net/playground), edit a sentence, and inspect the map. Compilation happens in your browser; no account is needed.

That is enough to begin. The [quick start](quick-start.md) adds naming and explicit connections when needed. The [examples](https://cogitatum.onesimos.net/examples) offer notes you can adapt.

Cogitatum is semi-formal: the marks have precise structural effects; the prose remains open to interpretation.
The historical 0.3 Alpha packages and the published 0.4 packages have different language and compiler contracts.
The production playground is deployed separately from npm packages.
Use documentation and the complete schema set matching your installed compiler.
