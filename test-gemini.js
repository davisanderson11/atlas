// test-gemini.js
import 'dotenv/config.js';
import { GoogleGenAI } from '@google/genai';

async function main() {
  // For API-key–based Developer API:
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // Or, to use Vertex AI instead:
  // const ai = new GoogleGenAI({
  //   vertexai: true,
  //   project: process.env.GOOGLE_CLOUD_PROJECT,
  //   location: process.env.GOOGLE_CLOUD_LOCATION
  // });

  // Generate a one-sentence greeting
  const response = await ai.models.generateContent({
    model: 'gemini-1.5-pro',
    contents: 'Hello Gemini! Give me a one-sentence greeting.'
  });

  console.log('>', response.text.trim());
}

main().catch(err => {
  console.error('API error:', err);
  process.exit(1);
});
