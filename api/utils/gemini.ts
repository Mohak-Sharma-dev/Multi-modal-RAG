import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
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
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
  
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
  return response.text();
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