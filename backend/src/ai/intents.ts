// All structured intents that Claude can return

export type IntentType =
  | 'create_task'
  | 'create_tasks_bulk'
  | 'list_tasks'
  | 'list_ideas'
  | 'list_thoughts'
  | 'list_resources'
  | 'list_wins'
  | 'list_goals'
  | 'complete_task'
  | 'complete_tasks_bulk'
  | 'move_task_date'
  | 'move_tasks_bulk'
  | 'group_action'
  | 'add_thought'
  | 'add_idea'
  | 'add_win'
  | 'add_goal'
  | 'create_resource'
  | 'daily_debrief'
  | 'save_debrief'
  | 'weekly_review'
  | 'set_idea_next_step'
  | 'promote_idea_to_project'
  | 'undo_last'
  | 'unknown';

export interface CreateTaskIntent {
  intent: 'create_task';
  data: {
    title: string;
    notes?: string;
    due_date?: string; // YYYY-MM-DD
    project_id?: string;
  };
}

export interface CreateTasksBulkIntent {
  intent: 'create_tasks_bulk';
  data: {
    tasks: Array<{ title: string; due_date?: string }>;
  };
}

export interface ListTasksIntent {
  intent: 'list_tasks';
  data: {
    filter?: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'all';
  };
}

export interface ListIdeasIntent {
  intent: 'list_ideas';
  data: Record<string, never>;
}

export interface ListThoughtsIntent {
  intent: 'list_thoughts';
  data: Record<string, never>;
}

export interface ListResourcesIntent {
  intent: 'list_resources';
  data: Record<string, never>;
}

export interface ListWinsIntent {
  intent: 'list_wins';
  data: Record<string, never>;
}

export interface ListGoalsIntent {
  intent: 'list_goals';
  data: {
    filter?: 'active' | 'all' | 'quarter';
    quarter?: string; // e.g. '2026-Q2'
  };
}

export interface CompleteTaskIntent {
  intent: 'complete_task';
  data: {
    task_id?: string;
    task_title?: string;
  };
}

export interface CompleteTasksBulkIntent {
  intent: 'complete_tasks_bulk';
  data: {
    positions?: number[];    // positional refs from last shown task list
    task_ids?: string[];     // UUIDs (resolved from positions in bot.ts)
    task_titles?: string[];  // title-based fallback
  };
}

export interface MoveTaskDateIntent {
  intent: 'move_task_date';
  data: {
    task_id?: string;
    task_title?: string;
    new_due_date: string; // YYYY-MM-DD
  };
}

export interface MoveTasksBulkIntent {
  intent: 'move_tasks_bulk';
  data: {
    positions?: number[];
    task_ids?: string[];
    task_titles?: string[];
    new_due_date: string;
  };
}

export interface GroupActionIntent {
  intent: 'group_action';
  data: {
    action: 'complete' | 'move_date';
    group: 'overdue' | 'today' | 'all';
    new_due_date?: string;
  };
}

export interface AddThoughtIntent {
  intent: 'add_thought';
  data: {
    content: string;
  };
}

export interface AddIdeaIntent {
  intent: 'add_idea';
  data: {
    content: string;
    actionability?: string;
  };
}

export interface AddWinIntent {
  intent: 'add_win';
  data: {
    content: string;
    entry_date?: string; // YYYY-MM-DD
  };
}

export interface AddGoalIntent {
  intent: 'add_goal';
  data: {
    title: string;
    description?: string;
    target_date?: string; // YYYY-MM-DD
  };
}

export interface CreateResourceIntent {
  intent: 'create_resource';
  data: {
    title: string;
    content_or_url?: string;
    type?: string;
  };
}

export interface DailyDebriefIntent {
  intent: 'daily_debrief';
  data: Record<string, never>;
}

export interface SaveDebriefIntent {
  intent: 'save_debrief';
  data: {
    entry_date: string;   // YYYY-MM-DD — plan date (MIT/K1/K2 stored here)
    debrief_date?: string; // YYYY-MM-DD — date being debriefed (journal/wins stored here)
    wake_time?: string;   // HH:MM — wake time for the plan date
    work_start?: string;  // HH:MM — work start time (defaults to wake_time + 1hr)
    mit?: string;
    k1?: string;
    k2?: string;
    open_journal?: string;
    wins?: string[];
    task_completions?: string[]; // task ids to mark done
    task_due_date_changes?: Array<{ id: string; due_date: string }>;
  };
}

export interface UndoLastIntent {
  intent: 'undo_last';
  data: Record<string, never>;
}

export interface WeeklyReviewIntent {
  intent: 'weekly_review';
  data: Record<string, never>;
}

export interface SetIdeaNextStepIntent {
  intent: 'set_idea_next_step';
  data: {
    position?: number;       // positional ref from last shown idea list
    idea_id?: string;        // UUID
    idea_content?: string;   // fuzzy title match fallback
    next_step: string;
  };
}

export interface PromoteIdeaToProjectIntent {
  intent: 'promote_idea_to_project';
  data: {
    position?: number;
    idea_id?: string;
    idea_content?: string;
  };
}

export interface UnknownIntent {
  intent: 'unknown';
  data: {
    message: string;
  };
}

export type Intent =
  | CreateTaskIntent
  | CreateTasksBulkIntent
  | ListTasksIntent
  | ListIdeasIntent
  | ListThoughtsIntent
  | ListResourcesIntent
  | ListWinsIntent
  | ListGoalsIntent
  | CompleteTaskIntent
  | CompleteTasksBulkIntent
  | MoveTaskDateIntent
  | MoveTasksBulkIntent
  | GroupActionIntent
  | AddThoughtIntent
  | AddIdeaIntent
  | AddWinIntent
  | AddGoalIntent
  | CreateResourceIntent
  | DailyDebriefIntent
  | SaveDebriefIntent
  | WeeklyReviewIntent
  | SetIdeaNextStepIntent
  | PromoteIdeaToProjectIntent
  | UndoLastIntent
  | UnknownIntent;

// ---------------------------------------------------------------------------
// Interpretation draft — wraps an Intent with routing metadata from Claude
// ---------------------------------------------------------------------------

export interface InterpretationDraft {
  intent: Intent;
  normalized_meaning: string;
  confidence: 'high' | 'medium' | 'low';
  ambiguities: string[];
  user_facing_summary: string;
  confirm_needed: boolean;
  follow_up_question?: string;
}

export type RouteDecision =
  | { action: 'execute'; intent: Intent }
  | { action: 'confirm'; intent: Intent; question: string }
  | { action: 'ask'; question: string };

/**
 * Pure routing function: decides whether to execute, confirm, or ask a
 * follow-up based on the draft Claude returned. No side effects.
 *
 * Rules:
 *   confidence "low"  → ask a clarifying question (never execute blindly)
 *   confirm_needed    → surface intent to user for confirmation first
 *   otherwise         → execute directly
 */
export function routeDraft(draft: InterpretationDraft): RouteDecision {
  if (draft.confidence === 'low') {
    return {
      action: 'ask',
      question: draft.follow_up_question ?? draft.user_facing_summary,
    };
  }
  if (draft.confirm_needed) {
    return {
      action: 'confirm',
      intent: draft.intent,
      question: draft.user_facing_summary,
    };
  }
  return { action: 'execute', intent: draft.intent };
}

// ---------------------------------------------------------------------------
// Top-level message classification (4-way router)
// ---------------------------------------------------------------------------

export type CaptureType = 'idea' | 'thought' | 'win' | 'goal' | 'resource';
export type RouteType = 'app_action' | 'assistant_answer' | 'capture_candidate' | 'casual';

/**
 * Unified classification result returned by classifyAndRespond().
 * The populated fields depend on route_type.
 */
export interface ClassifiedMessage {
  route_type: RouteType;
  confidence: 'high' | 'medium' | 'low';
  ambiguities: string[];

  // app_action fields
  intent?: Intent;
  confirm_needed?: boolean;
  follow_up_question?: string;
  user_facing_summary?: string;

  // assistant_answer fields
  answer?: string;
  needs_tool?: string;          // tool name when external data is required
  tool_params?: Record<string, unknown>;

  // capture_candidate fields
  capture_type?: CaptureType;
  capture_content?: string;

  // casual field
  reply?: string;
}

/**
 * What the bot should actually do with a ClassifiedMessage.
 * Pure — no I/O.
 */
export type BotAction =
  | { action: 'reply'; text: string }
  | { action: 'execute'; intent: Intent }
  | { action: 'confirm_intent'; intent: Intent; question: string }
  | { action: 'ask'; question: string }
  | { action: 'confirm_capture'; captureType: CaptureType; captureContent: string; question: string };

/** Convert a capture_candidate classification into a structured Intent for the executor. */
export function captureToIntent(type: CaptureType, content: string): Intent {
  switch (type) {
    case 'idea':     return { intent: 'add_idea',        data: { content } };
    case 'thought':  return { intent: 'add_thought',     data: { content } };
    case 'win':      return { intent: 'add_win',         data: { content } };
    case 'goal':     return { intent: 'add_goal',        data: { title: content } };
    case 'resource': return { intent: 'create_resource', data: { title: content } };
  }
}

/**
 * Pure routing function: maps a ClassifiedMessage to a BotAction.
 * No side effects — fully testable without Claude or DB.
 */
export function routeClassified(msg: ClassifiedMessage): BotAction {
  switch (msg.route_type) {
    case 'casual':
      return { action: 'reply', text: msg.reply ?? msg.user_facing_summary ?? 'Hey!' };

    case 'assistant_answer': {
      // When needs_tool is set, tool execution happens in bot.ts before routeClassified is called.
      // If we reach here with needs_tool still set, the tool was not executed (not configured or failed).
      // Never use Claude's answer field in this case — it would be fabricated competence.
      if (msg.needs_tool) {
        return {
          action: 'reply',
          text: `I can help answer questions, but live ${msg.needs_tool} lookup isn't connected yet.`,
        };
      }
      return { action: 'reply', text: msg.answer ?? msg.user_facing_summary ?? '' };
    }

    case 'capture_candidate': {
      const type = msg.capture_type ?? 'thought';
      const content = msg.capture_content ?? '';
      // High confidence + no confirmation required → save immediately
      if (msg.confidence === 'high' && !msg.confirm_needed) {
        return { action: 'execute', intent: captureToIntent(type, content) };
      }
      return {
        action: 'confirm_capture',
        captureType: type,
        captureContent: content,
        question: msg.user_facing_summary ?? 'Want me to save this?',
      };
    }

    case 'app_action':
    default: {
      if (!msg.intent || msg.confidence === 'low') {
        return {
          action: 'ask',
          question: msg.follow_up_question ?? msg.user_facing_summary ?? 'Could you be more specific?',
        };
      }
      if (msg.confirm_needed) {
        return {
          action: 'confirm_intent',
          intent: msg.intent,
          question: msg.user_facing_summary ?? 'Should I go ahead?',
        };
      }
      return { action: 'execute', intent: msg.intent };
    }
  }
}
