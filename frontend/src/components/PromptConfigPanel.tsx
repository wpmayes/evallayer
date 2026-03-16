/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useEval, type PromptConfig } from "./EvalContext";
import { API_BASE_URL } from "../config";

interface ModelOption {
  id: string;
  description?: string;
  params?: string;
}

export default function PromptConfigPanel() {
  const { promptConfigs, setPromptConfigs, selectedPrompt, setSelectedPrompt } = useEval();

  const [hfModels, setHfModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/inference/models`);
        if (!resp.ok) throw new Error("Failed to fetch models");
        const data = await resp.json();
        setHfModels(data.huggingface?.models ?? []);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        setModelsError("Could not load models — using defaults");
        setHfModels([
          { id: "HuggingFaceH4/zephyr-7b-beta", params: "7B", description: "Fast, reliable default" },
          { id: "meta-llama/Meta-Llama-3-8B-Instruct", params: "8B", description: "Meta Llama 3 8B" },
          { id: "meta-llama/Meta-Llama-3-70B-Instruct", params: "70B", description: "Best for judging" },
        ]);
      } finally {
        setModelsLoading(false);
      }
    };
    fetchModels();
  }, []);

  const defaultPrompt: PromptConfig = {
    id: Date.now(),
    name: "New Prompt",
    modelName: "HuggingFaceH4/zephyr-7b-beta",
    provider: "huggingface",
    comparisonModelName: "",
    comparisonProvider: "huggingface",
    judgeModelName: "meta-llama/Meta-Llama-3-70B-Instruct",
    judgeProvider: "huggingface",
    systemPrompt: "",
    userTemplate: "Process the following:\n\n{{input}}",
    temperature: 0.7,
    maxTokens: 200,
    schema: '{"field": "string"}',
    runsPerCase: 1,
    retryOnInvalid: true,
  };

  const [formState, setFormState] = useState<PromptConfig>(selectedPrompt || defaultPrompt);

  useEffect(() => {
    if (selectedPrompt) setFormState(selectedPrompt);
  }, [selectedPrompt]);

  const handleChange = (field: keyof PromptConfig, value: any) => {
    let newValue = value;
    switch (field) {
      case "temperature":
        newValue = Math.max(0, Math.min(1, parseFloat(value)));
        break;
      case "runsPerCase":
        newValue = Math.max(1, Math.min(5, parseInt(value)));
        break;
      case "maxTokens":
        newValue = Math.max(1, Math.min(1000, parseInt(value)));
        break;
      default:
        break;
    }
    setFormState({ ...formState, [field]: newValue });
  };

  const handleSave = () => {
    const updatedConfigs = promptConfigs.find(c => c.id === formState.id)
      ? promptConfigs.map(c => (c.id === formState.id ? formState : c))
      : [...promptConfigs, formState];
    setPromptConfigs(updatedConfigs);
    setSelectedPrompt(formState);
  };

  const handleNew = () => {
    const newPrompt = { ...defaultPrompt, id: Date.now(), name: "New Prompt" };
    setFormState(newPrompt);
    setSelectedPrompt(newPrompt);
  };

  const ModelSelect = ({
    value,
    onChange,
    includeNone = false,
  }: {
    value: string;
    onChange: (id: string) => void;
    includeNone?: boolean;
  }) => {
    if (modelsLoading) return <select disabled><option>Loading models...</option></select>;
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {includeNone && <option value="">— None —</option>}
        {hfModels.map(m => (
          <option key={m.id} value={m.id}>{m.id}</option>
        ))}
      </select>
    );
  };

  return (
    <div className="form-panel">
      <h2>Prompt Config</h2>

      <div className="form-row">
        <div className="form-col">
          <label>Name</label>
          <input
            value={formState.name}
            onChange={(e) => handleChange("name", e.target.value)}
          />
        </div>
      </div>

      {/* Primary model */}
      <div className="form-full">
        <label>Primary Model</label>
        <ModelSelect
          value={formState.modelName}
          onChange={(id) => setFormState({ ...formState, modelName: id, provider: "huggingface" })}
        />
        {modelsError && (
          <span style={{ fontSize: "0.75rem", color: "#f59e0b" }}>{modelsError}</span>
        )}
      </div>

      {/* Comparison model */}
      <div className="form-full">
        <label>
          Comparison Model{" "}
          <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: "normal" }}>
            (optional - for model-vs-model evaluation)
          </span>
        </label>
        <ModelSelect
          value={formState.comparisonModelName ?? ""}
          onChange={(id) => setFormState({ ...formState, comparisonModelName: id, comparisonProvider: "huggingface" })}
          includeNone
        />
        {formState.comparisonModelName && (
          <span style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem", display: "block" }}>
            Comparing: {formState.modelName.split("/").pop()} vs {formState.comparisonModelName.split("/").pop()}
          </span>
        )}
      </div>

      {/* Judge model */}
      <div className="form-full">
        <label>
          LLM Judge Model{" "}
          <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: "normal" }}>
            (used for semantic evaluation when LLM Check is enabled on a test case)
          </span>
        </label>
        <ModelSelect
          value={formState.judgeModelName ?? "meta-llama/Meta-Llama-3-70B-Instruct"}
          onChange={(id) => setFormState({ ...formState, judgeModelName: id, judgeProvider: "huggingface" })}
        />
        <span style={{ fontSize: "0.72rem", color: "#64748b", marginTop: "0.25rem", display: "block" }}>
          Larger models produce more reliable judgements. Recommended: Meta-Llama-3-70B-Instruct.
        </span>
      </div>

      <div className="form-full">
        <label>System Prompt</label>
        <textarea
          rows={4}
          value={formState.systemPrompt}
          onChange={(e) => handleChange("systemPrompt", e.target.value)}
        />
      </div>

      <div className="form-full">
        <label>User Template (use {"{{input}}"})</label>
        <textarea
          rows={3}
          value={formState.userTemplate}
          onChange={(e) => handleChange("userTemplate", e.target.value)}
        />
      </div>

      <div className="form-row">
        <div className="form-col">
          <label>Temperature</label>
          <input
            type="number"
            step={0.1}
            min={0}
            max={1}
            value={formState.temperature}
            onChange={(e) => handleChange("temperature", e.target.value)}
          />
        </div>
        <div className="form-col">
          <label>Max Tokens</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={formState.maxTokens}
            onChange={(e) => handleChange("maxTokens", e.target.value)}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-col">
          <label>Expected Output Schema (JSON)</label>
          <textarea
            rows={5}
            value={formState.schema}
            onChange={(e) => handleChange("schema", e.target.value)}
          />
        </div>
        <div className="form-col">
          <label>Runs Per Test Case</label>
          <input
            type="number"
            min={1}
            max={10}
            value={formState.runsPerCase}
            onChange={(e) => handleChange("runsPerCase", e.target.value)}
          />
        </div>
      </div>

      <div className="button-row">
        <button onClick={handleSave}>Save Config</button>
        <button onClick={handleNew}>New Config</button>
      </div>

      <hr />

      <h3>Saved Configs</h3>
      {promptConfigs.length === 0 && <p>No saved prompts yet.</p>}
      {promptConfigs.map((config) => (
        <div
          key={config.id}
          className={`card ${selectedPrompt?.id === config.id ? "selected" : ""}`}
          onClick={() => {
            setSelectedPrompt(config);
            setFormState(config);
          }}
        >
          {config.name}
          {config.comparisonModelName && (
            <span style={{ fontSize: "0.72rem", color: "#64748b", marginLeft: "0.5rem" }}>
              vs {config.comparisonModelName.split("/").pop()}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}