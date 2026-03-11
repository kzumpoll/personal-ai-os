/**
 * Voice note handling — OpenAI Whisper (whisper-1) transcription.
 *
 * Required env var:
 *   OPENAI_API_KEY  — standard OpenAI API key
 *
 * Flow:
 *   1. Telegram sends a voice message with a file_id
 *   2. getFilePath resolves the file_id to a download URL
 *   3. downloadVoiceNote fetches the raw audio bytes
 *   4. transcribeAudio sends to Whisper, returns plain text
 *   5. bot.ts feeds the transcript into handleText() — same path as typed text
 *
 * This means every Telegram input type (text, voice) flows through identical
 * intent interpretation and is stored the same way.
 */

import OpenAI from 'openai';
import { toFile } from 'openai';
import axios from 'axios';

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  return new OpenAI({ apiKey });
}

export async function downloadVoiceNote(fileUrl: string): Promise<Buffer> {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

export async function transcribeAudio(audioBuffer: Buffer, filename = 'voice.oga'): Promise<string> {
  const openai = getOpenAI();

  // Wrap the buffer as a File-like object for the OpenAI SDK
  const file = await toFile(audioBuffer, filename, { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
  });

  return transcription.text;
}

export async function getFilePath(botToken: string, fileId: string): Promise<string> {
  const res = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const filePath = res.data.result.file_path as string;
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}
