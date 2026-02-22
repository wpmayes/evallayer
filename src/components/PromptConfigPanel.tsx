/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useEval, type PromptConfig } from "./EvalContext";

export default function PromptConfigPanel() {
  const { promptConfigs, setPromptConfigs, selectedPrompt, setSelectedPrompt } = useEval();

  const defaultPrompt: PromptConfig = {
    // eslint-disable-next-line react-hooks/purity
    id: Date.now(),
    name: "New Prompt",
    modelName: "HuggingFaceH4/zephyr-7b-beta",
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
      // clamp between 0 and 1
      newValue = Math.max(0, Math.min(1, parseFloat(value)));
      break;

    case "runsPerCase":
      // clamp between 1 and 5
      newValue = Math.max(1, Math.min(5, parseInt(value)));
      break;

    case "maxTokens":
      // clamp between 1 and 1000
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
  <div className="form-col">
    <label>Model</label>
    <select
      value={formState.modelName}
      onChange={(e) => handleChange("modelName", e.target.value)}
    >
      <option value="HuggingFaceH4/zephyr-7b-beta">zephyr-7b-beta</option>
      <option value="mistralai/Mistral-7B-Instruct-v0.2">Mistral-7B-Instruct-v0.2</option>
    </select>
  </div>
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
        </div>
      ))}
    </div>
  );
}
