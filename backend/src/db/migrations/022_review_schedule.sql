CREATE TABLE IF NOT EXISTS review_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type TEXT NOT NULL UNIQUE,     -- 'weekly', 'monthly', 'quarterly', 'annual'
  cadence_days INTEGER NOT NULL,        -- 7, 30, 90, 365
  last_completed_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ NOT NULL,
  template JSONB NOT NULL DEFAULT '[]', -- array of { question: string, category: string }
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default review schedules
INSERT INTO review_schedule (review_type, cadence_days, next_due_at, template) VALUES
('weekly', 7, NOW(), '[
  {"question": "What were my top 3 wins this week?", "category": "wins"},
  {"question": "What did I learn this week?", "category": "learning"},
  {"question": "What blocked me and how did I handle it?", "category": "blockers"},
  {"question": "Did I make progress on my goals? Which ones?", "category": "goals"},
  {"question": "What would I do differently?", "category": "reflection"},
  {"question": "How am I feeling physically and mentally?", "category": "wellbeing"},
  {"question": "What am I most grateful for this week?", "category": "gratitude"},
  {"question": "What are my top 3 priorities for next week?", "category": "planning"},
  {"question": "Is there anything I need to say no to?", "category": "boundaries"},
  {"question": "One thing that made me smile this week?", "category": "joy"}
]'::jsonb),
('monthly', 30, NOW() + INTERVAL '23 days', '[
  {"question": "What were my biggest accomplishments this month?", "category": "wins"},
  {"question": "How did I progress on my quarterly goals?", "category": "goals"},
  {"question": "What habits served me well? Which ones didn''t?", "category": "habits"},
  {"question": "How are my finances tracking?", "category": "finances"},
  {"question": "What relationships did I invest in?", "category": "relationships"},
  {"question": "What new skills or knowledge did I gain?", "category": "growth"},
  {"question": "What projects need attention next month?", "category": "projects"},
  {"question": "Am I aligned with my values and vision?", "category": "alignment"},
  {"question": "What do I want to manifest next month?", "category": "manifestation"},
  {"question": "One word to describe this month?", "category": "reflection"}
]'::jsonb),
('quarterly', 90, NOW() + INTERVAL '60 days', '[
  {"question": "What were my top 5 achievements this quarter?", "category": "wins"},
  {"question": "Which goals did I complete? Which stalled?", "category": "goals"},
  {"question": "What big decisions did I make and how did they turn out?", "category": "decisions"},
  {"question": "How has my lifestyle changed?", "category": "lifestyle"},
  {"question": "What do I want to stop, start, and continue?", "category": "ssc"},
  {"question": "Am I on track for my annual vision?", "category": "vision"},
  {"question": "What relationships need more attention?", "category": "relationships"},
  {"question": "How is my financial trajectory?", "category": "finances"},
  {"question": "What would I tell myself 3 months ago?", "category": "wisdom"},
  {"question": "What are my top 3 goals for next quarter?", "category": "planning"}
]'::jsonb)
ON CONFLICT (review_type) DO NOTHING;
