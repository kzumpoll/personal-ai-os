import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_CATEGORIES = [
  'Income', 'Transfers', 'FX', 'Banking & Fees', 'Transport', 'Flights',
  'Stays', 'Food & Coffee', 'Groceries', 'Fitness & Padel', 'Health & Care',
  'Software & AI', 'Phone & Connectivity', 'Education', 'Shopping',
  'Entertainment & Events', 'Tea & Hobbies', 'Business Services',
  'Creator Economy', 'Within Expenses', 'Uncategorized',
];

const RULES: Array<{ patterns: string[]; category: string }> = [
  { patterns: ['uber', 'bolt', 'careem', 'gojek', 'grab', 'taxi', 'rta', 'nol', 'salik'], category: 'Transport' },
  { patterns: ['exchange', 'forex', 'wise', 'transferwise', 'western union', 'fx ', 'currency'], category: 'FX' },
  { patterns: ['transfer', 'wire', 'remittance'], category: 'Transfers' },
  { patterns: ['plan fee', 'account fee', 'service charge', 'bank charge', 'monthly fee', 'annual fee', 'maintenance fee', 'subscription fee'], category: 'Banking & Fees' },
  { patterns: ['salary', 'payroll', 'wages', 'dividend', 'freelance payment', 'invoice payment'], category: 'Income' },
  { patterns: ['amazon', 'noon', 'namshi', 'shein', 'zara', 'h&m', 'ikea', 'apple store', 'level shoes', 'bloomingdales', 'mall'], category: 'Shopping' },
  { patterns: ['netflix', 'spotify', 'openai', 'chatgpt', 'claude', 'anthropic', 'github', 'google one', 'icloud', 'dropbox', 'notion', 'figma', 'linear', 'cursor ', 'copilot', 'midjourney', 'adobe', 'vercel', 'railway', 'aws ', 'azure ', 'digitalocean', 'heroku', 'supabase', 'planetscale', 'resend', 'twilio', 'stripe'], category: 'Software & AI' },
  { patterns: ['starbucks', 'costa', 'cafe', 'coffee', 'restaurant', 'pizza', 'mcdonalds', 'kfc', 'burger king', 'subway', 'sushi', 'shawarma', 'biryani', 'thai', 'japanese', 'chinese', 'turkish', 'bistro', 'grill', 'diner', 'eatery', 'brasserie', 'canteen'], category: 'Food & Coffee' },
  { patterns: ['carrefour', 'lulu', 'waitrose', 'spinneys', 'supermarket', 'grocery', 'hypermarket', 'union coop', 'choithrams', 'geant'], category: 'Groceries' },
  { patterns: ['gym', 'padel', 'fitness', 'sport', 'arena', 'jungle padel', 'smash', 'squash', 'tennis', 'yoga', 'pilates', 'crossfit'], category: 'Fitness & Padel' },
  { patterns: ['pharmacy', 'hospital', 'clinic', 'doctor', 'medical', 'health', 'dental', 'optician', 'lab test', 'chemist', 'aster', 'mediclinic', 'life pharmacy'], category: 'Health & Care' },
  { patterns: ['hotel', 'airbnb', 'booking.com', 'expedia', 'rove', 'marriott', 'hilton', 'hyatt', 'accor', 'ibis', 'radisson', 'rotana'], category: 'Stays' },
  { patterns: ['emirates', 'etihad', 'flydubai', 'air arabia', 'airline', 'flight', 'lufthansa', 'british airways', 'qatar airways', 'air india', 'indigo', 'spicejet'], category: 'Flights' },
  { patterns: ['du ', 'etisalat', 'e& ', 'telecom', 'mobile plan', 'data plan', 'sim card', 'roaming'], category: 'Phone & Connectivity' },
  { patterns: ['udemy', 'coursera', 'masterclass', 'skillshare', 'books', 'bookshop', 'amazon kindle', 'university', 'tuition', 'school fee', 'training'], category: 'Education' },
  { patterns: ['cinema', 'movie', 'concert', 'event', 'ticket', 'vox ', 'reel cinemas', 'dubai frame', 'global village', 'museum', 'expo', 'theme park'], category: 'Entertainment & Events' },
  { patterns: ['within', 'tea house', 'tea shop', 'tea blend', 'teaware', 'tea ceremony'], category: 'Within Expenses' },
  { patterns: ['beehiiv', 'substack', 'youtube', 'patreon', 'ko-fi', 'gumroad', 'lemon squeezy', 'camera', 'lens', 'tripod', 'microphone', 'studio'], category: 'Creator Economy' },
];

function applyRules(merchant: string): string | null {
  const lower = merchant.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some(p => lower.includes(p))) return rule.category;
  }
  return null;
}

function extractMerchant(tx: { merchant_raw?: string | null; description: string }): string {
  return (tx.merchant_raw ?? tx.description).trim().slice(0, 120);
}

interface TxInput {
  id: string;
  merchant_raw?: string | null;
  description: string;
  direction?: string | null;
  amount: string | number;
  currency: string;
}

interface Suggestion {
  category: string;
  confidence: number;
  reason: string;
  source: 'memory' | 'llm' | 'rules';
}

export async function POST(req: NextRequest) {
  try {
    const { transactions } = await req.json() as { transactions: TxInput[] };
    if (!transactions?.length) return NextResponse.json({ suggestions: {} });

    const suggestions: Record<string, Suggestion> = {};
    const needsLLM: TxInput[] = [];

    // 1. Batch-check merchant memory
    const merchants = transactions.map(tx => extractMerchant(tx));
    const { rows: memRows } = await pool.query<{ merchant_name: string; category_name: string; usage_count: number }>(
      `SELECT merchant_name, category_name, usage_count
       FROM merchant_category_memory
       WHERE merchant_name = ANY($1)`,
      [merchants]
    );
    const memMap = new Map(memRows.map(r => [r.merchant_name, r]));

    for (const tx of transactions) {
      const merchant = extractMerchant(tx);
      const mem = memMap.get(merchant);
      if (mem) {
        suggestions[tx.id] = {
          category:   mem.category_name,
          confidence: 1.0,
          reason:     `Previously confirmed (used ${mem.usage_count}×)`,
          source:     'memory',
        };
      } else {
        needsLLM.push(tx);
      }
    }

    // 2. LLM for unknowns
    if (needsLLM.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic();
      const txList = needsLLM.map(tx => ({
        id:          tx.id,
        merchant:    extractMerchant(tx),
        description: tx.description,
        direction:   tx.direction ?? 'unknown',
        amount:      tx.amount,
        currency:    tx.currency,
      }));

      const prompt = `You are a finance categorization assistant for a personal dashboard.
Categorize each transaction into EXACTLY one category from this list:
${ALLOWED_CATEGORIES.join(', ')}

Return a JSON object where each key is the transaction id and the value is:
{ "category": string, "confidence": number (0-1), "reason": string (max 10 words) }

Transactions:
${JSON.stringify(txList, null, 2)}

Guidelines:
- Credit transactions from employers/clients → "Income"
- Currency exchange (Wise, FX bureau, exchange) → "FX"
- Bank-to-bank or wallet transfers → "Transfers"
- Software & AI: Anthropic, Claude, OpenAI, ChatGPT, GitHub, Notion, Figma, Linear, Cursor, Vercel, Railway, AWS, Adobe, Spotify, Netflix, Dropbox, iCloud, Google One, any SaaS/API/cloud service
- Within Expenses: anything related to the tea brand "Within" or within.ae
- Creator Economy: Beehiiv, Substack, YouTube, camera/studio equipment, content creation tools
- Use "Uncategorized" only if genuinely unclear (confidence < 0.5)
- Keep reason concise (merchant type + signal used)

Return ONLY the JSON object, no markdown or extra text.`;

      try {
        const message = await client.messages.create({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages:   [{ role: 'user', content: prompt }],
        });
        const text      = message.content[0].type === 'text' ? message.content[0].text : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, { category: string; confidence: number; reason: string }>;
          for (const tx of needsLLM) {
            const s = parsed[tx.id];
            if (s && ALLOWED_CATEGORIES.includes(s.category)) {
              suggestions[tx.id] = { ...s, source: 'llm' };
            }
          }
        }
      } catch (llmErr) {
        console.error('[suggest] LLM error:', llmErr instanceof Error ? llmErr.message : String(llmErr));
      }
    }

    // 3. Rule fallback for anything still without a suggestion
    for (const tx of needsLLM) {
      if (!suggestions[tx.id]) {
        const ruleCat = applyRules(extractMerchant(tx));
        suggestions[tx.id] = {
          category:   ruleCat ?? 'Uncategorized',
          confidence: ruleCat ? 0.6 : 0.3,
          reason:     ruleCat ? 'Keyword match' : 'No match found',
          source:     'rules',
        };
      }
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    logDbError('api/finances/suggest POST', err);
    return NextResponse.json({ error: 'Failed to get suggestions' }, { status: 500 });
  }
}
