/**
 * weather.ts — real weather tool using wttr.in (no API key required).
 *
 * Also exports executeToolCall(), the single dispatch point for all tool calls
 * from the assistant_answer path.
 */

import axios from 'axios';

// ---------------------------------------------------------------------------
// wttr.in JSON response types (minimal subset we use)
// ---------------------------------------------------------------------------

interface WttrCurrentCondition {
  temp_C: string;
  FeelsLikeC: string;
  weatherDesc: Array<{ value: string }>;
  humidity: string;
}

interface WttrHourly {
  time: string;        // "0", "300", ..., "2100"
  tempC: string;
  weatherDesc: Array<{ value: string }>;
}

interface WttrDay {
  date: string;
  mintempC: string;
  maxtempC: string;
  hourly: WttrHourly[];
}

interface WttrResponse {
  current_condition: WttrCurrentCondition[];
  weather: WttrDay[];
}

// ---------------------------------------------------------------------------
// Weather fetch
// ---------------------------------------------------------------------------

export async function fetchWeather(location: string, date?: string): Promise<string> {
  if (!location.trim()) {
    return 'Which location did you have in mind for the weather?';
  }

  const encoded = encodeURIComponent(location.trim());
  const url = `https://wttr.in/${encoded}?format=j1`;

  console.log('[weather] fetching:', { location, date, url });

  let data: WttrResponse;
  try {
    const res = await axios.get<WttrResponse>(url, { timeout: 8000 });
    data = res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[weather] fetch error:', msg);
    return `Couldn't fetch weather for "${location}" right now — try again in a moment.`;
  }

  // Current conditions (today, right now)
  if (!date || date === 'today' || date === 'now' || date === 'current') {
    const current = data.current_condition?.[0];
    if (!current) return `No current weather data found for "${location}".`;
    const desc = current.weatherDesc?.[0]?.value ?? 'Unknown';
    const temp = current.temp_C ? `${current.temp_C}°C` : '?';
    const feels = current.FeelsLikeC ? ` (feels like ${current.FeelsLikeC}°C)` : '';
    const humidity = current.humidity ? `, ${current.humidity}% humidity` : '';
    return `${location}: ${desc}, ${temp}${feels}${humidity}`;
  }

  // Tomorrow forecast
  const day = data.weather?.[1] ?? data.weather?.[0];
  if (!day) return `No forecast data found for "${location}".`;
  // Midday conditions (index 4 = 1200 in the 0/300/600/.../2100 sequence)
  const midday = day.hourly?.find((h) => h.time === '1200') ?? day.hourly?.[Math.floor((day.hourly?.length ?? 0) / 2)];
  const desc = midday?.weatherDesc?.[0]?.value ?? 'Unknown';
  const range = `${day.mintempC}–${day.maxtempC}°C`;
  return `Tomorrow in ${location}: ${desc}, ${range}`;
}

// ---------------------------------------------------------------------------
// Tool dispatcher — single entry point from bot.ts
// ---------------------------------------------------------------------------

export async function executeToolCall(
  tool: string,
  params: Record<string, unknown>
): Promise<string> {
  console.log('[tool] executing:', tool, JSON.stringify(params));

  switch (tool) {
    case 'weather': {
      const location = (params.location as string | undefined) ?? '';
      const date = (params.date as string | undefined) ?? 'today';
      return await fetchWeather(location, date);
    }
    case 'web_search': {
      const query = (params.query as string | undefined) ?? '';
      return await webSearch(query);
    }
    default:
      return `I can help answer questions, but live ${tool} lookup isn't connected yet.`;
  }
}

// ---------------------------------------------------------------------------
// Web search — DuckDuckGo instant answer + HTML scraping fallback
// ---------------------------------------------------------------------------

async function webSearch(query: string): Promise<string> {
  if (!query.trim()) return 'What would you like me to search for?';

  try {
    // DuckDuckGo instant answer API
    const encoded = encodeURIComponent(query.trim());
    const res = await axios.get(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`, { timeout: 8000 });
    const data = res.data;

    const parts: string[] = [];

    if (data.AbstractText) {
      parts.push(data.AbstractText);
      if (data.AbstractSource) parts.push(`Source: ${data.AbstractSource}`);
    }

    if (data.Answer) {
      parts.push(data.Answer);
    }

    // Related topics as snippets
    if (Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0) {
      const snippets = data.RelatedTopics
        .filter((t: Record<string, unknown>) => typeof t.Text === 'string')
        .slice(0, 5)
        .map((t: Record<string, unknown>) => `• ${t.Text}`);
      if (snippets.length > 0) parts.push('\nRelated:\n' + snippets.join('\n'));
    }

    if (parts.length > 0) return parts.join('\n');

    return `I searched for "${query}" but couldn't find a quick answer. Try rephrasing or ask me something more specific.`;
  } catch (err) {
    console.error('[web_search] error:', err instanceof Error ? err.message : err);
    return `Search for "${query}" failed — try again in a moment.`;
  }
}
