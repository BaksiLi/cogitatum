# Preserve a Bearing while checking an interpretation

This repository experiment addresses #21's local-checking question and #32's separation of negative relations from theoretical attack types.
It is a runnable example, not a public interpretation API or a new core syntax.
Run `npm run probe:interpretation` from the checkout; use `npm run --silent probe:interpretation` for JSON without npm's command banner.
The implementation lives in `scripts/interpretation-probe/run.mjs` and runs under the existing Node 22+ toolchain.
Its tests participate in `npm run check`.
The unchanged fixture has been rechecked with the 0.6 compiler against published 0.5:
only version fields and the empty object-note projection differ.
This does not expand the experiment's interpretation or assessment scope.

## The recorded inquiry

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- A reconstruction to inspect, not an established account of the weather.
- [C @rain] It rained.
  - [G @wet; @weather-route] The ground is wet.
    - [O/ @sprinkler; @alternative] A sprinkler can also wet the ground.
- [note] Scope of the reconstruction.
  - Neither the presence of rain nor the operation of a sprinkler has been independently established.
```

The original support and challenge remain present under both readings.
Neither the compiler nor this experiment removes a relation because a particular interpretation fails.
The output retains the complete source envelope, AST, Graph IR and Explain, along with the text inspection view.
Each reading identifies the selected Bearing instances and mapped Points using typed, graph-scoped references.
These keys are scoped to this snapshot, not persistent identities across edits.

## Two readings, explicit assumptions

Both readings use a finite classical propositional model with eight valuations of W, R and S.
W means the ground is wet; R means it rained; S means a sprinkler operated in the selected situation.
The first reading uses only W and R; S is irrelevant to its result.
The propositional abstraction discards time, intensity and other qualifications, so its applicability to the prose still needs human review.

| Reading | Assumptions and question | Observed result |
| --- | --- | --- |
| Deductive | Does W entail R, with no additional background? | No. W=true, R=false is a counterexample. |
| Explanatory | Assume R → W and S → W; test R and S separately as candidate explanations for W. | Each candidate is consistent with the background and entails W. W still does not entail R. |

R → W is explicitly introduced by the interpreter.
S → W is an interpretation of the objection's prose, assumed for this check; the experiment does not verify that translation or treat the sprinkler as actually operating.
No extra premise, atom, or inferred conclusion is inserted into the recorded graph.
The two tested candidates are explicitly listed, not an exhaustive list of causes.

The explanatory check establishes only consistency and explanatory sufficiency in this simplified model.
It supplies witnesses and model counts; it does not rank causes, estimate probabilities, identify the actual cause, or establish a best explanation.
This is a bounded probe of an abductive reading, not a general abduction implementation.
The challenge's classification as a theory-specific undercut remains unassessed.
Contradictory assumptions produce `inconsistent-assumptions`, not a misleading successful explanation through classical explosion.

## Provenance and failure boundaries

The interpretation is pinned to the SHA-256 of the complete reviewed document, including ordinary body and literal notes.
Passing a changed file with `npm run probe:interpretation -- changed.cog.md` fails with `STALE_INTERPRETATION` and emits no assessment.
Even a note edit that leaves graph inspection identical requires review before rebinding the reading.
This is deliberately conservative; an automatic change-impact analysis is outside the experiment.
Do not update the pinned hash as a substitute for reviewing the translation and assumptions.

Output records compiler and format versions, the source hash, a fingerprint of the compiled source envelope, and the probe theory version.
The fingerprint identifies the emitted representation; it is not a compiler binary or dependency fingerprint.
The script checks its expected compiler/format version and the selected relations' kinds, ordered sources and typed targets before evaluating them.
It does not provide a persistent assessment cache or cross-version result validator.
Durable reuse across compiler builds would require an implementation/dependency identity as well as these source and interpretation identities.

## Core boundaries and precedents

Bearings record relations asserted or reconstructed in an inquiry without certifying their success.
Interpretations map selected material to theoretical constructs under explicit assumptions.
Assessments report results under those interpretations while preserving the recorded relations.
Representation is already a reading of the material; the distinction does not pretend that choosing a core Bearing is free of interpretation.

A Bearing-targeted `challenges` is not automatically an undercut.
For example, ASPIC+ undercutting requires an attack on the applicability of a defeasible rule, not just a Bearing endpoint.
See [Modgil and Prakken's ASPIC+ tutorial](https://journals.sagepub.com/doi/full/10.1080/19462166.2013.869766).
The core rejects the retired named `undercuts` spelling; a future theory-specific use requires an explicit versioned contract, rather than inheriting alias semantics.

Likewise, discourse relations do not supply a dialogue-event model by themselves.
AIF+ TA nodes represent transition applications between locutions; IAT illocutionary connections anchor dialogue and argument structure.
See the [AIF+ paper](https://www.simonwells.org/assets/papers/reed_2008_aif.plus.pdf) and the [IAT corpus analysis](https://aclanthology.org/L16-1161/).
Cogitatum Points are not automatically locution events, and `respondsTo`, `answers`, or `clarifies` cannot be converted into TA or YA nodes just by renaming them.
Repeated content and repeated utterances require different identity decisions.

The next contract questions are interpretation provenance, faithful translation, selection across revisions, and theory-specific evidence.
They should be tested with further paired cases before choosing a public adapter API.
No new global Argumentative/Dialogical type split, validity field, resolution command, or source rewrite is introduced here.
