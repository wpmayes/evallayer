# EvalLayer

EvalLayer is a structured evaluation framework for testing **Large Language Models (LLMs)** against explicit, repeatable criteria.  
It is designed to give developers and researchers **quantitative feedback** on prompt performance and model behaviour.

A demo version is deployed at evallayer.netlify.app.

---

## 🔹 Features

- Create and manage **prompts** with system and user templates.  
- Add structured **test cases** with expected outputs.  
- Run evaluations with three types of checks:
  - **Deterministic**: exact string match.  
  - **Normalised**: ignore minor formatting differences.  
  - **LLM semantic check**: uses an LLM to assess correctness.  
- View **per-test-case runs**, pass rates, latency, and detailed reasoning.  
- Download **prompt configurations** and **evaluation results** as CSV.  

---

## 💻 Local Development

> ⚠️ Because EvalLayer uses serverless functions for LLM calls, **full evaluation functionality requires deployment** (e.g., via Netlify). Local development can still run the UI.

1. Clone the repo:

git clone https://github.com/yourusername/evallayer.git
cd evallayer

2. Install dependencies:

npm install

3. Start the local dev server:

npm run dev

The UI will run at http://localhost:5173 (default Vite port).  
⚠️ Note: serverless functions will not work locally unless you configure a local serverless emulator or mock the responses.

## 📜 License

© 2026 William P. Mayes

This project is licensed under the **MIT License**. You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of this software, subject to the following conditions:

- The above copyright notice and this permission notice shall be included in all copies or substantial portions of the software.
- The software is provided "as is", without warranty of any kind, express or implied.

For full details, see the [MIT License](https://opensource.org/licenses/MIT).