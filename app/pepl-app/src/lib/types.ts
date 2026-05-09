// =============================================================================
// PEPL — TypeScript types
// Matches the Postgres schema from supabase/migrations/0001_schema.sql.
//
// In production, these should be auto-generated via:
//   npx supabase gen types typescript --linked > src/lib/database.types.ts
// and then re-exported here.
// =============================================================================

export type LeagueStatus = 'draft' | 'active' | 'completed';
export type SeasonStatus = 'not_started' | 'in_progress' | 'completed';
export type RoundStatus = 'open' | 'locked' | 'resolved';
export type EventStatus = 'open' | 'locked' | 'resolved';
export type Outcome = 'yes' | 'no';
export type Role = 'admin' | 'member';
export type LedgerReason = 'Wrong pick' | 'No pick forfeiture';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface League {
  id: string;
  name: string;
  admin_user_id: string;
  source_of_truth: string;
  description: string | null;
  status: LeagueStatus;
  created_at: string;
}

export interface LeagueMembership {
  id: string;
  league_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface Season {
  id: string;
  league_id: string;
  season_number: number;
  rounds_total: number;
  starting_credits: number;
  credit_loss_per_wrong_pick: number;
  status: SeasonStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface Round {
  id: string;
  season_id: string;
  round_number: number;
  title: string;
  status: RoundStatus;
  picks_open_at: string;
  round_lock_at: string | null;
  finalized_at: string | null;
  finalized_by_user_id: string | null;
  created_at: string;
}

export interface PEvent {
  id: string;
  round_id: string;
  title: string;
  prompt: string;
  start_time: string;
  pick_lock_at: string;
  status: EventStatus;
  resolved_outcome: Outcome | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Pick {
  id: string;
  event_id: string;
  user_id: string;
  choice: Outcome;
  submitted_at: string;
}

export interface SeasonParticipant {
  id: string;
  season_id: string;
  user_id: string;
  credits_remaining: number;
  wrong_picks_count: number;
  correct_picks_count: number;
  is_eliminated: boolean;
  eliminated_at: string | null;
  created_at: string;
}

export interface CreditLedgerEntry {
  id: string;
  season_id: string;
  user_id: string;
  event_id: string | null;
  round_number: number;
  delta: number;
  reason: LedgerReason;
  created_at: string;
}

// MVP fixed rules (PRD §6.1)
export const MVP_RULES = {
  STARTING_CREDITS: 100,
  CREDIT_LOSS: 5,
  ROUNDS_PER_SEASON: 6,
} as const;
