# EvalLayer

A structured evaluation framework for testing large language models against well-defined, repeatable criteria. EvalLayer combines deterministic checks, normalised matching, and LLM-as-judge evaluation with statistical analysis and model comparison.

**Live demo:** [evallayer.netlify.app](https://evallayer.netlify.app)  
**API docs:** [evallayer-backend-production.up.railway.app/docs/](https://evallayer-backend-production.up.railway.app/docs/)

---

## What it does

EvalLayer addresses a common problem in LLM development: evaluation is often informal, undocumented, and difficult to reproduce. The framework provides:

- **Three validation methods** — exact match, normalised (case/punctuation-insensitive), and LLM-as-judge semantic evaluation
- **Configurable judge model** — independently selectable from the primary inference model, enabling separation of inference quality from evaluation rigour
- **Statistical analysis** — Wilson score confidence intervals and Bernoulli consistency scoring per test case and overall
- **Model comparison** — run two models against the same test suite; McNemar's test available when paired results exist
- **Cost and token tracking** — prompt tokens, completion tokens, and estimated cost per run surfaced in the UI and exported reports
- **Structured exports** — prompt config CSV, per-run results CSV, and full JSON evaluation report including statistical analysis

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
- `src/config.ts` — API base URL configuration

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
VITE_API_BASE_URL=https://evallayer-backend-production.up.railway.app
```

---

## Backend

Built with FastAPI and Python. Deployed on Railway.

**Key files:**
- `app/main.py` — FastAPI app with CORS and lifespan configuration
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

**Frontend:** Netlify — set `VITE_API_BASE_URL` in Netlify environment variables to point at the Railway backend URL.

**Backend:** Railway — set `HUGGINGFACE_TOKEN`, `OPENROUTER_API_KEY`, and `DATABASE_URL` in Railway service variables.

**Database:** SQLite for development and current deployment. Swap `DATABASE_URL` to a PostgreSQL connection string for production persistence — Railway offers one-click PostgreSQL as an add-on.

---

## Background

EvalLayer was built to address a gap identified during LLM work in a regulated healthcare setting: evaluation pipelines were informal, undocumented, and difficult to reproduce. The same methodological challenge applies across regulated AI deployments — making evaluation defensible enough to withstand scrutiny from technical reviewers, regulators, and the people affected by the systems being evaluated.

The statistical layer — Wilson confidence intervals, consistency scoring, and McNemar's test — reflects the same rigour required in clinical and regulatory contexts: being precise about what a methodology can and cannot conclude, and communicating uncertainty honestly rather than reporting a pass rate as if it were a definitive finding.

---

## License

MIT © 2026 William P. Mayes