# Eval harness (§8.7)

`pnpm eval` runs the **real** pipeline (Claude + Google Cloud Vision, through a local Supabase stack) over the golden set and writes a report to `evals/reports/<timestamp>.{json,md}`.

It reports:

- transcription CER and **over-correction rate** (a student's mistake transcribed as the right answer)
- agreement with the teacher: exact, **within tolerance** (≤ 1 rubric level or ≤ 10 % of the item max), and quadratic weighted kappa
- **harsh** (AI below the teacher) and **lenient** error rates, reported separately
- confidence calibration: accuracy and share of items in each band ("high" must be ≥ 95 % right)
- anchor accuracy: IoU of AI pins vs reference boxes
- feedback quality from an LLM judge: specific / actionable / correct / tone
- run-to-run consistency (`EVAL_RUNS=3`) and, when the manifest has them, a second teacher's scores as the human baseline
- cost and latency

**Gate:** the run fails if within-tolerance agreement drops more than 2 points against `evals/reports/baseline.json`. Promote a report to baseline deliberately, in its own commit:

```bash
cp evals/reports/<stamp>.json evals/reports/baseline.json
```

## The golden set — consent first

Real papers only, **collected with written consent from the school and parents/guardians**, de-identified before they enter the repo:

- names and any identifying details blurred in the images
- no real names in the manifest
- a `consent_ref` that points to the signed record, which is kept outside the repo

Never add synthetic or AI-generated "student work": the numbers would be meaningless.

1. Put the images in `evals/golden/images/` (JPEG).
2. Copy `manifest.example.json` to `manifest.json` and describe the assignments, papers and teacher ground truth (scores per item, transcriptions with a `student_error` flag, reference annotation boxes).
3. Target: 30 papers to start, covering math steps, short answers and a paragraph-writing task, in ES and EN, with deliberately messy photos and diagram questions. Grow to 200+.

`evals/golden/images/` and `manifest.json` are git-ignored by default. Store the set in a private bucket, or commit it only if the school agreement allows.

## Running

Needs `ANTHROPIC_API_KEY`, Google Vision credentials, and `supabase start` (`SUPABASE_SECRET_KEY`).

```bash
pnpm eval
```

```bash
EVAL_RUNS=3 pnpm eval
```

```bash
EVAL_LIMIT=5 EVAL_JUDGE=0 pnpm eval
```

## Not yet implemented

- **Split vs joint comparison (§8.2).** Only the split pipeline exists. A joint transcribe-and-grade call is the next eval experiment.
