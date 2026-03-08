import axios from 'axios';
import FormData from 'form-data';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function downloadVoiceNote(fileUrl: string): Promise<Buffer> {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

export async function transcribeAudio(audioBuffer: Buffer, filename = 'voice.oga'): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBuffer, { filename, contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );

  return response.data.text as string;
}

export async function getFilePath(botToken: string, fileId: string): Promise<string> {
  const res = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const filePath = res.data.result.file_path as string;
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}
