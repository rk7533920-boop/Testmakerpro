# Parser lab — how Test Maker learns a book

## 1. Why the parser only worked on some books

Four things were hard-coded to the books it was first tuned on. Everything else was luck.

| What | Where it was fixed | What that meant |
|---|---|---|
| Which shapes count as a question number | `findQBoundaries` — 4 regexes: `Q1.`, `1 -`, `1.`/`1)`, `1.X` | A book printing `[1]` or `(1)` or `Question 1` produced **zero** questions |
| Which shapes count as an option marker | `findOptionRun` — `(a)`, `a)`, `a.` only | A book printing `(1)(2)(3)(4)` or `(i)(ii)(iii)(iv)` produced zero options, so every question was discarded |
| Which letter an answer can be | `parseBlock` — `([a-e*])` | Even when options were read, `Ans. (2)` was not recognised |
| Which lines are an institute's watermark | `stripCoachingJunk` — ForumIAS, "Shared Freely", "Dark horse"… with the comment *"add other institutes' watermarks here"* | Every new coaching institute needed a code change |

The old learning system only ever remembered two things: repeated header/footer lines, and
which of five global option bundles happened to work. It never learned the **layout** — the
part that actually differs from book to book. So a PDF from a new publisher was read as if
it were one of the original books, and quietly produced nothing.

## 2. What replaced it: a per-source grammar

A **grammar** is a small record of how one publication prints a question. It is stored as
a list of **IDs into a catalogue that lives in the app** (`GE_Q`, `GE_OPT`) — never as a
regex. A corrupted or tampered record cannot execute code or hang the browser.

```js
{ q:   ['q-dot','num-dash'],   // "Q1." and "1 -" are question numbers here
  opt: ['numparen'],           // options are printed (1) (2) (3) (4)
  phrases: ['shared\\s+freely\\s+in\\s+upsc\\s+test\\s+series\\s+zone'] }
```

Eleven question-number shapes and seven option-marker shapes are in the catalogue today.
Adding a shape is one line in the catalogue; no book-specific code is ever needed again.

## 3. How the layout is worked out

The app does not guess. It scores every plausible combination against the actual pages:

1. **Option alphabet, by balance.** A real option family prints one `(a)`, one `(b)`, one
   `(c)`, one `(d)` per question — so the counts for a,b,c,d come out nearly *equal*.
   That one cheap regex pass separates the family a book uses from the others.
2. **Question shapes.** Each candidate set is run through the real `findQBoundaries` on the
   *cleaned* text, and scored on how many questions it found, how many numbers are missing
   from the run, and how many blocks came out with options and an answer.
   Candidates include **subsets** as well as supersets, so a shape that is firing on the
   options (`1.`, `1)`) can be *dropped*, not just added.
3. **Full parse.** The three best shape sets × the shortlisted option families are parsed
   properly and the best-scoring combination wins.
4. **Verify.** The result is only trusted if the numbers form one unbroken run, every
   question has options and an answer, and nothing was rejected.
5. **Gate.** Before any layout is stored, it is re-run against the samples already saved
   *for that same source*. If it would change them, it is thrown away.

The two choices are coupled, and the code treats them that way: whether `1) Venus` survives
as a question depends on whether `1)` is also the option marker, so question shapes are
always probed with the option family this source actually uses.

## 4. How a book is recognised the next time

File names are useless — everyone renames their PDFs. Identity comes from the words:

- a **48-value MinHash** over 4-word shingles of the page text, and
- the publisher's own repeated **header/footer lines**.

A match needs a clear word overlap (≥ 0.45), or three shared furniture lines, or a moderate
overlap plus two shared lines. When a source is recognised, its layout is applied before the
first strategy is tried — the second student never pays for the first student's learning.

**A wrong memory cannot lose questions.** If a read comes out incomplete (or empty) with a
remembered layout switched on, the same text is read again without it, then re-derived from
scratch, and the best of the three wins. If the re-derived layout is better, it **replaces**
the memory for that book. This is covered by a test (`GE_grammarFailed` path).

## 5. What the app does with what it learns

```
student uploads a PDF
   └─ fingerprint → already known?
        ├─ yes → apply its layout, read, done (no learning needed)
        └─ no  → work out the layout → verify → gate
                   ├─ verified  → save on the device; send to the admin queue
                   └─ not verified → keep it locally only, never shared,
                                     and tell the student what was missed
admin opens Parser lab → reviews the queue → Approve
   └─ published to sourceGrammars → every student gets it on their next start
```

**Nothing reaches students until you approve it.** A layout that does not read every
question completely is never even put in the queue.

## 6. Using the Parser lab

Settings → **Teach the parser** (only visible when signed in with the admin Google
account — `POOL_ADMIN_EMAIL` near the top of the main script).

1. **Teach the parser a book.** Choose a PDF, pick up to 100 pages that contain questions
   *and* their answers, tap **Analyse**. You get:
   - the layout it chose, and a collapsible "why it chose those" showing what it ruled out
   - the watermarks it will now strip, each with the page count it was seen on
   - a confidence bar, and an explicit list of anything it could not read
   - whether it is safe to publish (the gate result)
   - the first few questions exactly as the app read them
2. **Publish** (or **Save on this device**). Publishing is blocked unless the read verified
   and the gate passed.
3. **Waiting for you** — the review queue. For each submission: "Test it here" re-runs the
   gate and its own sample, then Approve & publish or Reject.
4. **Known books** — everything published, with confidence and how many test samples are
   attached. Remove takes a book out of the library immediately (`off: true`).
5. **Run regression** — re-parses every layout the app knows: the 10 built-in tests, any
   samples saved on the device, and every sample attached to a published book.

## 7. Deploying it

The lab needs two new Firestore collections. Ship `firestore.rules` in this repo:

```
firebase deploy --only firestore:rules
```

- `sourceGrammars` — world-readable, admin-writable.
- `grammarSubs` — a device may create its own record (`uid_gid`), admin reads/deletes.

If you already have rules, keep them and add just the two blocks marked **NEW**.

## 8. What leaves a student's device

Only when a read **verifies completely**, and only if the student has not switched the
setting off (Settings → Backup & storage → *share how a book is laid out*):

- the layout: which shapes are question numbers and option markers (a few IDs),
- the normalised repeated header/footer lines,
- the fingerprint (48 numbers),
- mined watermark phrases, and
- **a text sample of up to 40,000 characters** used as a regression test.

That last one is the trade-off you chose: it is what lets the app prove, months later, that
a change has not broken that book. It is the only item that is real text. It is attached to
a **verified** read only, it sits in the review queue until you approve it, and you can see
the sample count on every published entry. To stop sending it, set `GE_fixture()` to return
`null` in the `PARSER LAB` script block; everything else keeps working.

Never sent: questions the student saved, their answers, their history, their name.

## 9. On "100% accuracy"

Being straight with you: no parser gets 100% on arbitrary PDFs, and this one does not claim
to. Some PDFs have no text layer at all (scans); some store options as images; some are
typeset in ways no text extraction can recover. What this design does guarantee is:

- **You always know.** Every read ends with an explicit completeness check: how many
  questions were read, how many answers the pages actually printed, and a list of what was
  missed and why. A half-read book is *surfaced*, never silently returned as if complete.
- **Only proven layouts spread.** A layout that does not read every question completely
  cannot be published, and cannot even reach your queue.
- **A bad memory is self-correcting.** If a remembered layout stops working on a book, the
  app notices, re-derives the layout, and replaces the memory.
- **It can only get better.** Every book you analyse adds to the library, every published
  book carries a regression sample, and the gate stops a new book from breaking an old one.

The realistic target is: *for any text-layer PDF whose questions follow one consistent
pattern, the first student gets a complete read or an honest report of what was missed, and
every student after them gets it instantly.*

## 10. Where the code lives

Everything is in `index.html` (the app stays a single file, no build step).

- the last `<script>` block, headed **PARSER LAB — SOURCE GRAMMAR ENGINE**: catalogues,
  inference, fingerprinting, mining, store, cloud sync, admin UI.
- six small hooks inside the original parser: `GE_qSpecs`, `GE_optStyles`,
  `GE_optSplitRe`, `GE_optNormRe`, `GE_restoreRe`, `GE_ansKeyFrag`.
- `screen-admin` in the HTML, plus the **Teach the parser** row in Settings.

To add a question-number or option-marker shape the app cannot yet see, add one line to
`GE_Q` or `GE_OPT`. Nothing else needs to change — the inference engine will pick it up
automatically for books that use it.
