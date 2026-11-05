import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

let genAIClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("WARNING: GEMINI_API_KEY environment variable is not set. Requests requiring AI generation may fail.");
    }
    genAIClient = new GoogleGenAI({
      apiKey: apiKey || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAIClient;
}

// ---------------------------------------------------------------------------
// SiliconFlow (OpenAI 兼容) — 默认模型 deepseek-ai/DeepSeek-V4.1-Flash（1M 上下文）
// ---------------------------------------------------------------------------
const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash";

export function isSiliconFlowConfigured(): boolean {
  return Boolean(process.env.SILICONFLOW_API_KEY);
}

export async function callSiliconFlowChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not set");

  const resp = await fetch(`${SILICONFLOW_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.15,
      max_tokens: 8192,
      enable_thinking: false,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`SiliconFlow API ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("SiliconFlow returned empty content");
  return content;
}
