import 'dotenv/config';
import type { Handler } from "@netlify/functions";

export const handler: Handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ HF_TOKEN: process.env.HF_TOKEN || "not set" }),
  };
};
