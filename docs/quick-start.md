---
title: Try a note in ten minutes
summary: Write a note, mark its reasoning, and connect a passage from elsewhere.
section: learn
order: 2
audience: Ten minutes
---

# Try a note in ten minutes

Open the [playground](https://cogitatum.onesimos.net/playground).
You can also keep the source in a file such as `inquiry.cog.md`.

## Start with ordinary writing

```md cog-check points=0 bearings=0 diagnostics=0
- The new deployment has produced intermittent timeouts.
  We are checking the cause before changing the database.
  - We have logs from two servers, but no comparison from last week.
```

Unmarked writing stays in Reading without adding Points or Bearings to the map.
A line without a new bullet continues the same block; indent it to where the text after `- ` begins.
Start a new bullet for a separate item.

## Mark the part you want to examine

```md cog-check require=supports,challenges points=4 bearings=2 diagnostics=0
- The new deployment has produced intermittent timeouts.
  - [Q] What explains the failures?
    - [C] The connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] An upstream service may be slow.
  - Check the traces before making changes.
```

`Q` presents a Question and `C` a Claim or possible answer.
`G` gives a reason for the nearest enclosing Point; `O` objects to it.
The Ground and Objection here connect to the Claim.

The Question organizes the discussion.
Nesting a Claim beneath it does not automatically record an answer or settle the question.
Use a neutral `[.]` when you want a Point without choosing a role.
See [Points](points.md) when you need the other marks or an explicit answer relation.

Keep qualifications such as “may” in the Point's wording.
Its complete block is its content, including continuation lines; the first line is not a separate title.

## Name something when you need to refer to it

Give the Claim a name, `@cause`, then connect a distant Objection using `->`:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @cause] The connection pool may be exhausted.
  - [G] Logs show connection acquisition failures.
- A separate check of the timeline:
  - [O -> @cause] Some timeouts started before this deployment.
```

Names let you refer to the same item from elsewhere.
The anonymous Ground and Objection are still complete Points.
An explicit target keeps this Objection connected to `@cause` even if you move it.

## Read the connections

Switch between Reading and Map.
Reading retains the context and wording; Map makes the selected connections easier to follow.
Select a Point or a Bearing to inspect what it connects.

For the next step, [Bearings](bearings.md#argument-structures) distinguishes three common structures:
separate reasons for one conclusion (**Convergent**), reasons used together (**Linked**), and one conclusion supporting another (**Serial**).
They describe how Points connect, rather than three kinds of Point.

## Writing and reconstruction

When developing your own explanation, keep tentative wording where it belongs.
When reconstructing someone else's argument, identify whose claim and reasoning you are recording:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- The report's explanation:
  - [C @cause] Pool exhaustion caused the timeouts.
    - [G] Logs show connection acquisition failures.
- My question about the report:
  - [Q] Did the report rule out a network fault?
```

The Claim and Ground preserve the report's argument even if you disagree.
The Question belongs to your examination; its position in the note does not attribute it to the report.
Preserve the source's qualifications and say when a premise or connection is your reconstruction.

Keep editing and rereading.
The compiler checks the marked structure and references; it does not establish that the argument is faithful, true or sufficient.
Continue with [writing style](writing-style.md) for notes that others can follow,
or [graph inspection](graph-inspection.md) to work with files and the CLI.
