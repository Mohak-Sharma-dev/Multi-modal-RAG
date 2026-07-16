import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[Gemini] GEMINI_API_KEY not set in environment');
}
const genAI = new GoogleGenerativeAI(apiKey || '');
const GENERATION_MODEL = 'gemini-1.5-flash';

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
}

export async function generateContent(
  prompt: string,
  options: GenerationOptions = {}
): Promise<string> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
  
  console.log('[Gemini] Generating content with model:', GENERATION_MODEL);
  console.log('[Gemini] Prompt length:', prompt.length);
  
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 2048,
      topP: options.topP ?? 0.95,
      topK: options.topK ?? 40
    }
  });

  const response = result.response;
  const text = response.text();
  console.log('[Gemini] Response length:', text.length);
  return text;
}

export async function generateImageDescription(base64Image: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
  
  const prompt = `You are a scientific research assistant reviewing figures from a paper. Analyze this cropped figure/diagram deeply. Provide an exhaustive technical description explaining every visible component, label, axis, line, box, table matrix elements, and structural connection. What architectural rule or piece of data does this figure convey? Do not leave out details.`;

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: 'image/png', data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048
    }
  });

  return result.response.text();
}