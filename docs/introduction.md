---
title: A one-minute introduction
summary: Keep writing ordinary prose. Mark a reason or question when it helps.
section: learn
order: 1
audience: One minute
---

# A one-minute introduction

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose.

Use it in an investigation, a reading note, or the reasons for a decision. Start with the writing. Add a mark where seeing a question or connection would help.

```md cog-check require=answers,supports,challenges
- We noticed slower requests after deployment. These notes collect what we know so far.
  - [Q] Why are requests timing out?
    - [C?] The connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] Upstream latency could also explain the timeouts.
  - We will compare the traces tomorrow before changing the configuration.
```

The two ordinary sentences remain body. Four marked points and three explicit connections become inspectable: a possible answer, a reason bearing positively on that answer, and an objection. The markup does not establish which explanation is right.

Paste the note into the [playground](https://cogitatum.baksili.codes/playground), edit a sentence, and inspect the map. Compilation happens in your browser; no account is needed.

That is enough to begin. The [quick start](quick-start.md) adds naming and explicit connections when needed. The [examples](https://cogitatum.baksili.codes/examples) offer notes you can adapt.

Cogitatum is semi-formal: the marks have precise structural effects; the prose remains open to interpretation. The 0.3 Public Alpha covers the inquiry markup language, compiler, and CLI.
