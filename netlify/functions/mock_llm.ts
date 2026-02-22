import { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prompt, testCaseInput, runNumber } = body;

  const fakeOutput = `Processed "${testCaseInput}" (Run ${runNumber})`;
  const valid = Math.random() > 0.2;

  return {
    statusCode: 200,
    body: JSON.stringify({ output: fakeOutput, valid }),
  };
};
