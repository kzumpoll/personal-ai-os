/**
 * Gemini image editing service.
 *
 * Sends an image + natural-language instruction to Gemini and returns the
 * edited image as a Buffer. Iterative edits are supported: pass the output
 * buffer of a previous call as the next imageBuffer.
 *
 * Model: gemini-3.1-flash-image-preview  (Nano Banana 2 API path)
 *
 * Required env var:
 *   GOOGLE_AI_API_KEY  — from Google AI Studio (aistudio.google.com)
 */

import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const MODEL = 'gemini-3.1-flash-image-preview';

function getAI(): GoogleGenerativeAI {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('GOOGLE_AI_API_KEY not set');
  return new GoogleGenerativeAI(key);
}

export interface ImageEditResult {
  imageBuffer: Buffer;
  mimeType: string;
  description: string | null;
}

/**
 * Edit an image using natural language.
 *
 * @param imageBuffer  Raw bytes of the source image
 * @param mimeType     e.g. 'image/jpeg', 'image/png', 'image/webp'
 * @param editPrompt   Natural language edit instruction
 */
export async function editImage(
  imageBuffer: Buffer,
  mimeType: string,
  editPrompt: string
): Promise<ImageEditResult> {
  const ai = getAI();

  // responseModalities is required to get image output from Gemini.
  // Cast through unknown because older SDK type definitions may not include it.
  const model = ai.getGenerativeModel({
    model: MODEL,
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
  };
}

export function isImageEditConfigured(): boolean {
  return Boolean(process.env.GOOGLE_AI_API_KEY);
}
