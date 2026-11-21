import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

type HandwritingLanguage = 'auto' | 'ar' | 'en';

interface RecognizeRequestBody {
  imageBase64?: string;
  language?: HandwritingLanguage;
}

interface RecognizeResponsePayload {
  text: string;
  detectedLanguage: 'ar' | 'en' | 'mixed' | 'none';
  confidence: number;
}

function normalizeLanguageMode(lang: unknown): HandwritingLanguage {
  if (lang === 'ar' || lang === 'en' || lang === 'auto') {
    return lang;
  }
  return 'auto';
}

function buildHandwritingPrompt(language: HandwritingLanguage): string {
  const langRule =
    language === 'ar'
      ? 'Strictly transcribe ONLY Arabic text (Arabic script and Arabic/Western numerals). Do NOT output Latin words or any other language.'
      : language === 'en'
      ? 'Strictly transcribe ONLY English text (Latin alphabet, punctuation, and numerals). Do NOT output Arabic or any other language.'
      : 'Strictly transcribe ONLY Arabic and/or English text (Arabic script, English Latin script, punctuation, and numerals). Never output any other language or script.';

  return [
    'You are a precision handwriting OCR engine similar to Apple Notes / GoodNotes.',
    'Analyze the isolated black-on-white handwriting strokes image.',
    langRule,
    'Rules:',
    '1. Correct natural handwriting imperfections while preserving exact intended spelling and Arabic diacritics if clearly written.',
    '2. Preserve intentional line breaks between lines; join strokes belonging to the same word cleanly.',
    '3. If the image is ONLY a non-text drawing, shape, arrow, underline, circle, or meaningless scribble with NO readable Arabic or English letters/digits, set text to "" and detectedLanguage to "none".',
    '4. Return ONLY valid JSON matching the schema.',
  ].join('\n');
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.post('/api/handwriting/recognize', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server.',
        });
        return;
      }

      const body = (req.body || {}) as RecognizeRequestBody;
      const rawImage = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      if (!rawImage) {
        res.status(400).json({ error: 'Missing handwriting imageBase64 payload.' });
        return;
      }

      const base64Data = rawImage.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
      if (!base64Data || base64Data.length < 32) {
        res.status(400).json({ error: 'Invalid handwriting image data.' });
        return;
      }

      const language = normalizeLanguageMode(body.language);
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Data,
                },
              },
              {
                text: buildHandwritingPrompt(language),
              },
            ],
          },
        ],
        config: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: {
                type: Type.STRING,
                description:
                  'Recognized text strictly in Arabic and/or English. Empty string if no readable text exists.',
              },
              detectedLanguage: {
                type: Type.STRING,
                description: 'One of: ar, en, mixed, none',
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Confidence score between 0 and 1',
              },
            },
            required: ['text', 'detectedLanguage', 'confidence'],
          },
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        res.status(502).json({ error: 'Empty response returned from recognition model.' });
        return;
      }

      const parsed = JSON.parse(rawText) as Partial<RecognizeResponsePayload>;
      const cleanText = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      const detLang =
        parsed.detectedLanguage === 'ar' ||
        parsed.detectedLanguage === 'en' ||
        parsed.detectedLanguage === 'mixed' ||
        parsed.detectedLanguage === 'none'
          ? parsed.detectedLanguage
          : cleanText
          ? 'mixed'
          : 'none';
      const confidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : cleanText
          ? 0.8
          : 0;

      res.json({
        text: cleanText,
        detectedLanguage: detLang,
        confidence,
      } satisfies RecognizeResponsePayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Handwriting recognition failed.';
      console.error('[handwriting/recognize]', err);
      res.status(500).json({ error: message });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

createApp();
