/**
 * Image editing service — Nano Banana 2.
 *
 * Provider preference:
 *   1. OpenRouter (OPENROUTER_API_KEY) — uses google/gemini-2.0-flash-exp:free
 *   2. Google AI Studio (GOOGLE_AI_API_KEY) — uses gemini-3.1-flash-image-preview
 *
 * Both accept image + natural-language instruction and return an edited image.
 * Iterative edits are supported: pass the output buffer as the next imageBuffer.
 */

import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const GOOGLE_MODEL = 'gemini-3.1-flash-image-preview';
const OPENROUTER_MODEL = 'google/gemini-2.0-flash-exp:free';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface ImageEditResult {
  imageBuffer: Buffer;
  mimeType: string;
  description: string | null;
  provider: 'openrouter' | 'google';
}

// ─── OpenRouter path ──────────────────────────────────────────────────────────

async function editViaOpenRouter(
  imageBuffer: Buffer,
  mimeType: string,
  editPrompt: string
): Promise<ImageEditResult> {
  const apiKey = process.env.OPENROUTER_API_KEY!;

  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image_url' as const,
            image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
          },
          { type: 'text' as const, text: editPrompt },
        ],
      },
    ],
    response_format: { type: 'image' },
  };

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const choice = data.choices?.[0]?.message;

  let imageBuffer64: string | null = null;
  let outputMimeType = 'image/png';
  let description: string | null = null;

  if (choice?.content && Array.isArray(choice.content)) {
    for (const part of choice.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        const dataUrl: string = part.image_url.url;
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          outputMimeType = match[1];
          imageBuffer64 = match[2];
        }
      }
      if (part.type === 'text' && part.text) {
        description = part.text;
      }
    }
  } else if (typeof choice?.content === 'string') {
    description = choice.content;
  }

  if (!imageBuffer64) {
    throw new Error('OpenRouter did not return an image in the response');
  }

  return {
    imageBuffer: Buffer.from(imageBuffer64, 'base64'),
    mimeType: outputMimeType,
    description,
    provider: 'openrouter',
  };
}

// ─── Google AI Studio path ────────────────────────────────────────────────────

async function editViaGoogle(
  imageBuffer: Buffer,
  mimeType: string,
  editPrompt: string
): Promise<ImageEditResult> {
  const key = process.env.GOOGLE_AI_API_KEY!;
  const ai = new GoogleGenerativeAI(key);

  const model = ai.getGenerativeModel({
    model: GOOGLE_MODEL,
    generationConfig: {
      responseModalities: ['image', 'text'],
    } as unknown as Record<string, unknown>,
  });

  const imagePart: Part = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType,
    },
  };

  const textPart: Part = { text: editPrompt };

  const result = await model.generateContent([imagePart, textPart]);
  const response = result.response;
  const parts = response.candidates?.[0]?.content?.parts ?? [];

  let imageBuffer64: string | null = null;
  let outputMimeType = 'image/png';
  let description: string | null = null;

  for (const part of parts) {
    if (part.inlineData?.data) {
      imageBuffer64 = part.inlineData.data;
      outputMimeType = part.inlineData.mimeType ?? 'image/png';
    }
    if (part.text) {
      description = part.text;
    }
  }

  if (!imageBuffer64) {
    throw new Error(
      'Gemini did not return an image. Check that GOOGLE_AI_API_KEY is valid and the model supports image generation.'
    );
  }

  return {
    imageBuffer: Buffer.from(imageBuffer64, 'base64'),
    mimeType: outputMimeType,
    description,
    provider: 'google',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Edit an image using natural language.
 * Prefers OpenRouter; falls back to Google AI Studio.
 */
export async function editImage(
  imageBuffer: Buffer,
  mimeType: string,
  editPrompt: string
): Promise<ImageEditResult> {
  if (process.env.OPENROUTER_API_KEY) {
    try {
      return await editViaOpenRouter(imageBuffer, mimeType, editPrompt);
    } catch (err) {
      console.warn('[imageEdit] OpenRouter failed, falling back to Google:', err instanceof Error ? err.message : err);
      if (!process.env.GOOGLE_AI_API_KEY) throw err;
    }
  }

  if (process.env.GOOGLE_AI_API_KEY) {
    return await editViaGoogle(imageBuffer, mimeType, editPrompt);
  }

  throw new Error('No image editing provider configured. Set OPENROUTER_API_KEY or GOOGLE_AI_API_KEY.');
}

export function isImageEditConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.GOOGLE_AI_API_KEY);
}
