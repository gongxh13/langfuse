import { z as zodV3 } from "zod/v3";
import {
  ChatMessageRole,
  ChatMessageType,
  LLMApiKeySchema,
  type ModelConfig,
} from "./types";
import { decrypt } from "../../encryption";
import { fetchLLMCompletion } from "./fetchLLMCompletion";
import { decryptAndParseExtraHeaders } from "./utils";
import z from "zod/v4";

const TestSchema = zodV3.object({
  score: zodV3.string(),
  reasoning: zodV3.string(),
});

export const testModelCall = async ({
  provider,
  model,
  apiKey,
  prompt,
  modelConfig,
}: {
  provider: string;
  model: string;
  apiKey: z.infer<typeof LLMApiKeySchema>;
  prompt?: string;
  modelConfig?: ModelConfig | null;
}) => {
  if (apiKey.supportsStructuredOutput) {
    const response = await fetchLLMCompletion({
      streaming: false,
      apiKey: decrypt(apiKey.secretKey), // decrypt the secret key
      extraHeaders: decryptAndParseExtraHeaders(apiKey.extraHeaders),
      baseURL: apiKey.baseURL ?? undefined,
      messages: [
        {
          role: ChatMessageRole.User,
          content: prompt ?? "mock content",
          type: ChatMessageType.User,
        },
      ],
      modelParams: {
        provider: provider,
        model: model,
        adapter: apiKey.adapter,
        ...modelConfig,
      },
      structuredOutputSchema: zodV3.object({
        score: zodV3.string(),
        reasoning: zodV3.string(),
      }),
      config: apiKey.config,
    });

    return response.completion;
  }

  // Don't support structure output
  return await testModelCallWithoutStructuredOutput({
    provider: provider,
    model: model,
    apiKey: apiKey,
    prompt: prompt,
    modelConfig: modelConfig,
  });
};

export const testModelCallWithoutStructuredOutput = async ({
  provider,
  model,
  apiKey,
  prompt,
  modelConfig,
}: {
  provider: string;
  model: string;
  apiKey: z.infer<typeof LLMApiKeySchema>;
  prompt?: string;
  modelConfig?: ModelConfig | null;
}) => {
  const enforcedPrompt = `
${prompt ?? "mock content"}

Now strictly respond in JSON format only, following this schema:
{
  "score": "string",
  "reasoning": "string"
}
Do not include any explanation or extra text outside of the JSON.
`;

  const response = await fetchLLMCompletion({
    streaming: false,
    apiKey: decrypt(apiKey.secretKey),
    extraHeaders: decryptAndParseExtraHeaders(apiKey.extraHeaders),
    baseURL: apiKey.baseURL ?? undefined,
    messages: [
      {
        role: ChatMessageRole.User,
        content: enforcedPrompt,
        type: ChatMessageType.User,
      },
    ],
    modelParams: {
      provider: provider,
      model: model,
      adapter: apiKey.adapter,
      ...modelConfig,
    },
    config: apiKey.config,
  });

  if (response.completion) {
    try {
      let content = response.completion.trim();
      const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
      const match = content.match(codeBlockRegex);
      if (match) {
        content = match[1].trim();
      }

      const parsed = JSON.parse(content);
      TestSchema.parse(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Model test failed: Unable to parse model response as valid JSON. Response: ${response.completion}`
        );
      }
      throw error;
    }
  }

  throw new Error("Model test failed: No completion returned.");
};