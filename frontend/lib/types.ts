// Domain types shared across the app. These mirror the shapes returned by the
// Postgres RPCs and the `reveal-decision` edge function.

export interface Venue {
  name: string;
  address: string;
  rating: number | null;
  price_level: number | null;
  photo_url: string | null;
  maps_url: string | null;
  walk_minutes: number | null;
}

export interface RevealResult {
  summary: string;
  cuisine: string;
  reasons: string[];
  ruled_out: string[];
  venue: Venue | null;
}

export type RoomStatus = "open" | "revealing" | "revealed";
export type Category = "eat" | "travel" | "watch" | "other";

// A participant's private answers, accumulated across rounds.
export interface ResponseAnswers {
  budget?: string;
  style?: string;
  avoid?: string;
  freestyle?: string;
  followups?: string[];
}

export interface RoomState {
  id: string;
  code: string;
  question: string;
  category: Category;
  location_label: string | null;
  host_id: string;
  is_host: boolean;
  status: RoomStatus;
  round: number;
  followups: string[];
  participant_count: number;
  answered_count: number;
  my_answers: ResponseAnswers;
  my_round: number; // highest round this user has completed (-1 = none)
  result: RevealResult | null;
  responses: { label: string; answers: ResponseAnswers }[] | null;
}

// ---- Social ----

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  is_pro: boolean;
}

export interface FriendUser {
  id: string;
  username: string;
  display_name: string | null;
  status?: "pending" | "accepted" | null;
  requested_by?: string | null;
}

export interface RoomInvite {
  code: string;
  question: string;
  category: Category;
  inviter: string;
}

export interface HomeData {
  profile: Profile;
  incoming_requests: number;
  invites: RoomInvite[];
}

export interface SocialData {
  friends: FriendUser[];
  incoming: FriendUser[];
  outgoing: FriendUser[];
}
