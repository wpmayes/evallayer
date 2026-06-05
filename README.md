# EvalLayer

A structured evaluation framework for testing large language models against well-defined, repeatable criteria. EvalLayer combines deterministic checks, normalised matching, and LLM-as-judge evaluation with statistical analysis and model comparison.

**Live demo:** [evallayer.netlify.app](https://evallayer.netlify.app)  
**API docs:** [evallayer-backend.onrender.com/docs/](https://evallayer-backend.onrender.com/docs/)

---

## What it does

EvalLayer addresses a common problem in LLM development: evaluation is often informal, undocumented, and difficult to reproduce. The framework provides:

- **Three validation methods** — exact match, normalised (case/punctuation-insensitive), and LLM-as-judge semantic evaluation
- **Configurable judge model** — independently selectable from the primary inference model, enabling separation of inference quality from evaluation rigour
- **Statistical analysis** — Wilson score confidence intervals and Bernoulli consistency scoring per test case and overall
- **Model comparison** — run two models against the same test suite; McNemar's test available when paired results exist
- **Cost and token tracking** — prompt tokens, completion tokens, and estimated cost per run surfaced in the UI and exported reports
- **Structured exports** — prompt config CSV, per-run results CSV, and full JSON evaluation report including statistical analysis
- **CLI / eval-as-code** — run YAML-defined suites from the terminal with no server, with a `--threshold` exit code for CI gating

---

## Architecture
```
evallayer/
├── frontend/          # React/TypeScript evaluation UI (Vite)
└── backend/           # FastAPI inference and evaluation API (Python)
```

The frontend handles prompt configuration, test case management, and results display. The backend provides a provider-abstracted inference API supporting HuggingFace Router and OpenRouter, with server-side scoring, statistical analysis, and model comparison endpoints.

---

## Frontend

Built with React, TypeScript, and Vite. Deployed on Netlify.

**Key files:**
- `src/components/PromptConfigPanel.tsx` — prompt and model configuration, including judge model selection and optional comparison model
- `src/components/TestCasePanel.tsx` — test case management with per-case validation options
- `src/components/EvaluationResultsPanel.tsx` — results display with CI, consistency scoring, judge reasoning, and downloadable reports
- `src/utils/runEvaluation.ts` — evaluation orchestration, routes inference and judge calls through the backend API
- `src/utils/statsUtils.ts` — Wilson CI, Bernoulli consistency, McNemar's test (pure TypeScript, no dependencies)
- `src/utils/hybridEval.ts` — client-side deterministic and normalised checks
- `src/utils/sampleSuite.ts` — the ready-to-run "Load example suite" demo (no key needed; uses the live backend)
- `src/utils/suiteExport.ts` — exports the current UI suite as `suite.yaml` for the CLI (the UI→CLI bridge)
- `src/config.ts` — API base URL configuration

The results panel shows the Wilson CI as a visual error bar with plain-language tooltips, and flags the normalised-match limitation inline. "Export suite.yaml" turns a UI-built suite into a file the CLI runs unchanged.

**Local development:**
```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local` to point at your local backend:
```
VITE_API_BASE_URL=http://localhost:8000
```

Or point at the live backend:
```
VITE_API_BASE_URL=https://evallayer-backend.onrender.com
```

---

## Backend

Built with FastAPI and Python. Deployed on Render.

**Key files:**
- `app/main.py` — FastAPI app with CORS and lifespan configuration
- `app/cli.py` — terminal entry point for running suites as code (`evallayer` / `python -m app.cli`)
- `app/services/evaluator.py` — shared fan-out loop used by both the web worker and the CLI
- `app/services/model_registry.py` — live HF / OpenRouter model lists, shared by the API and `evallayer models`
- `app/routers/inference.py` — inference endpoint with live model registry from HF Router and OpenRouter
- `app/routers/runs.py` — evaluation run orchestration with background task execution and statistical comparison
- `app/routers/suites.py` — test suite and test case CRUD
- `app/services/llm_providers.py` — provider abstraction (HuggingFace Router, OpenRouter, Ollama)
- `app/services/scoring.py` — deterministic, normalised, and LLM-judge scoring with structured JSON output
- `app/services/stats.py` — Wilson CI, consistency scoring, McNemar's test (scipy)
- `app/models/schema.py` — SQLModel database schema

**Local development:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Create `backend/.env`:
```
HUGGINGFACE_TOKEN=your_hf_token
OPENROUTER_API_KEY=your_openrouter_key
DATABASE_URL=sqlite:///./evallayer.db
```

Interactive API documentation available at `http://localhost:8000/docs/` when running locally.

---

## CLI

EvalLayer ships as a ready-to-go test harness you can drive from the terminal — no server, no database, no frontend. Drop your own provider key in `backend/.env`, describe a suite as a YAML file, and run it. Inference, scoring, and statistics use the same code as the web UI, so a CLI run is equivalent to a UI run.

**Setup:**
```bash
cd backend
pip install -e .                           # installs deps + the `evallayer` command
```
`pip install -e .` exposes EvalLayer as an `evallayer` command. If you'd rather not install, every command also works as `python -m app.cli …` after `pip install -r requirements.txt`.

**Provider keys** are read from the environment, or from a `.env` file in whatever directory you run `evallayer` from (real environment variables win over `.env`):
```bash
export HUGGINGFACE_TOKEN=your_hf_token     # or put it in ./.env
# optional, for OpenRouter models:
export OPENROUTER_API_KEY=your_or_key
```
`run` and `compare` validate the key up front and fail fast with a clear message if it's missing — no wall of per-case errors.

**Discover models** to test (live from HuggingFace / OpenRouter, needs the relevant key):
```bash
evallayer models                           # everything, both providers
evallayer models --search llama --limit 10 # filter by ID substring
evallayer models --provider openrouter --free
```

**Scaffold and run a suite:**
```bash
evallayer init suite.yaml                  # write an example suite
evallayer run suite.yaml                   # run it, print a results table
```

**A suite file** defines the prompt, model, and test cases. Each case lists which checks to apply (`strict`, `normalised`, `llm`):
```yaml
name: Geography basics
provider: huggingface            # huggingface | openrouter | ollama
model: HuggingFaceH4/zephyr-7b-beta
prompt:
  system_prompt: "Answer with just the answer, no preamble."
  user_template: "{question}"
run_config:
  temperature: 0.0
  max_tokens: 256
runs: 5                          # evaluate each case 5 times (default 1)
judge:                           # only used by cases with an 'llm' check
  provider: huggingface
  model: meta-llama/Meta-Llama-3-70B-Instruct
cases:
  - name: capital-france
    input: { question: "What is the capital of France?" }
    expected: Paris
    checks: [normalised]
  - name: largest-planet
    input: { question: "Which is the largest planet?" }
    expected: Jupiter
    checks: [normalised, llm]
```
A working example lives at `backend/examples/geography.yaml`. JSON suite files also work (YAML is a JSON superset), so a suite exported from the frontend can be replayed on the command line.

**Repeated runs** — set `runs: N` to evaluate every case N times. LLM outputs vary run-to-run, so a single run can't tell you whether a pass was reliable or luck. With `runs > 1` the CLI reports per-case pass counts (e.g. `3/5`), a Bernoulli **consistency** score (HIGH / MEDIUM / LOW) flagging unstable cases, and tighter Wilson confidence intervals.

**Comparing two models** — `compare` runs the suite against two models on identical cases and applies McNemar's paired test. Model A is the suite's `model`; model B is `--model-b`:
```bash
evallayer compare suite.yaml --model-b mistralai/Mistral-7B-Instruct-v0.3
evallayer compare suite.yaml --model-b openai/gpt-4o-mini --provider-b openrouter \
    --report compare.json --fail-on-regression
```
When `runs > 1`, each case is reduced to a single pass/fail by majority vote before comparison (the McNemar paired-design assumption). The output classifies each case as `fixed`, `regressed`, `unchanged`, or `error`. Cases where a model errored (e.g. a bad model ID or rate limit) are marked `ERR` and counted separately rather than mistaken for regressions, with a warning so a misconfigured `--model-b` is obvious. `--fail-on-regression` exits non-zero on any regression *or* errored case — a CI gate against shipping a worse (or broken) model.

**Options** (`run`, and `--report`/`--concurrency`/`--json` also apply to `compare`):

| Flag | Purpose |
|------|---------|
| `--report PATH` | Write a full JSON report (same shape as the frontend export). |
| `--threshold 0..1` | `run` only — exit non-zero if the pass rate falls below this. |
| `--model-b MODEL` | `compare` only — the second model to evaluate (B). |
| `--provider-b NAME` | `compare` only — provider for model B (defaults to the suite's). |
| `--fail-on-regression` | `compare` only — exit non-zero if any case regressed from A to B. |
| `--concurrency N` | Max simultaneous LLM calls (default 5). |
| `--json` | Emit the JSON report to stdout instead of a table. |

**Exit codes:** `0` pass rate meets `--threshold` / no regressions; `1` below threshold (`run`) or a regression with `--fail-on-regression` (`compare`); `2` usage or suite-file error.

**CI example** (GitHub Actions):
```yaml
- run: |
    cd backend
    pip install -e .
    # Gate on absolute quality...
    evallayer run evals/regression.yaml --threshold 0.9 --report report.json
    # ...and/or gate on regressions against the current production model:
    evallayer compare evals/regression.yaml --model-b "$PROD_MODEL" --fail-on-regression
  env:
    HUGGINGFACE_TOKEN: ${{ secrets.HUGGINGFACE_TOKEN }}
```

**Tests:** the CLI logic (suite parsing, per-case aggregation, consistency scoring, and the compare/McNemar path) is covered by offline unit tests in `backend/test_cli.py`:
```bash
cd backend
pip install -e ".[dev]"
python -m pytest test_cli.py -q
```

---

## Providers

| Provider | Models | Notes |
|----------|--------|-------|
| HuggingFace Router | 100+ open models | Free. Uses `:fastest` policy by default. Append `:cheapest` or `:provider-name` to override. |
| OpenRouter | 300+ models including GPT-4o, Claude, Llama | Free tier available with rate limits. Paid tier from ~$0.001/call. |
| Ollama | Local models | Free, no key needed. Best for development. |

Model selection is live — the frontend fetches available models from both providers on load rather than relying on a hardcoded list.

---

## Evaluation methodology

**Deterministic check:** Exact string match between output and expected value.

**Normalised check:** Case-insensitive, punctuation-stripped substring match. Supports variant lists and regex patterns.

**LLM judge:** A secondary model evaluates semantic correctness against the expected criteria. Returns structured JSON `{"pass": bool, "reason": string}`. The judge model is independently configurable — larger models produce more reliable judgements. Recommended: `meta-llama/Meta-Llama-3-70B-Instruct` for HuggingFace, `anthropic/claude-3.5-sonnet` for high-stakes evaluations via OpenRouter.

**Statistical analysis:**
- Wilson score confidence intervals (95%) on pass rates — preferred over normal approximation for small samples
- Bernoulli variance as a consistency signal — flags unstable model behaviour across repeated runs
- McNemar's test for paired model comparison — exact binomial for n < 25 discordant pairs, chi-squared with continuity correction for larger samples; requires at least 10 discordant pairs for reliable results

**Known limitation:** String-based normalised checks can produce false negatives when a correct answer is embedded in verbose output (e.g. "The answer is Paris" may fail a check for "Paris" depending on substring matching). This is surfaced explicitly in evaluation reports and is a known limitation of string-based evaluation — the LLM judge check handles these cases correctly.

---

## Deployment

**Frontend:** Netlify — set `VITE_API_BASE_URL` in Netlify environment variables to point at the Render backend URL.

**Backend:** Render — set `HUGGINGFACE_TOKEN`, `OPENROUTER_API_KEY`, and `DATABASE_URL` in the Render service's environment variables.

**Database:** SQLite for development and current deployment. Swap `DATABASE_URL` to a PostgreSQL connection string for production persistence — Render offers a managed PostgreSQL add-on.

---

## Background

EvalLayer was built to address a gap identified during LLM work in a regulated healthcare setting: evaluation pipelines were informal, undocumented, and difficult to reproduce. The same methodological challenge applies across regulated AI deployments — making evaluation defensible enough to withstand scrutiny from technical reviewers, regulators, and the people affected by the systems being evaluated.

The statistical layer — Wilson confidence intervals, consistency scoring, and McNemar's test — reflects the same rigour required in clinical and regulatory contexts: being precise about what a methodology can and cannot conclude, and communicating uncertainty honestly rather than reporting a pass rate as if it were a definitive finding.

---

## License

MIT © 2026 William P. Mayes