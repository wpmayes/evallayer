var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/mock_llm.ts
var mock_llm_exports = {};
__export(mock_llm_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(mock_llm_exports);
var handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const { prompt, testCaseInput, runNumber } = body;
  const fakeOutput = `Processed "${testCaseInput}" (Run ${runNumber})`;
  const valid = Math.random() > 0.2;
  return {
    statusCode: 200,
    body: JSON.stringify({ output: fakeOutput, valid })
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=mock_llm.js.map
