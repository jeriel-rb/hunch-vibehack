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

export interface PlaceOption {
  id: string;
  option_index: number;
  cuisine: string;
  rationale: string;
  reasons: string[];
  ruled_out: string[];
  venue: Venue;
}

export interface RevealResult {
  summary: string;
  cuisine: string;
  reasons: string[];
  ruled_out: string[];
  venue: Venue | null;
  options?: PlaceOption[];
  selected_option_id?: string;
  consensus_copy?: string;
  success_title?: string;
  success_copy?: string;
}

export type RoomStatus =
  | "waiting"
  | "open"
  | "choosing"
  | "revealing"
  | "revealed";
export type RoomInviteStatus = "pending" | "accepted" | "declined";
export type Category = "eat" | "travel" | "watch" | "other";

// A participant's private answers, accumulated across rounds.
export interface ResponseAnswers {
  budget?: string;
  style?: string;
  avoid?: string;
  freestyle?: string;
  followups?: string[];
}

export interface RoomMember {
  id: string;
  username: string;
  display_name: string | null;
  role: "host" | "member";
  status: RoomInviteStatus;
  is_current_user: boolean;
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
  private_prompt: string | null;
  private_prompts: string[];
  participant_count: number;
  answered_count: number;
  my_answers: ResponseAnswers;
  my_round: number; // highest round this user has completed (-1 = none)
  result: RevealResult | null;
  responses: { label: string; answers: ResponseAnswers }[] | null;
  invite_status: RoomInviteStatus | null;
  members: RoomMember[];
  place_options: PlaceOption[];
  my_place_vote: string | null;
  votes_cast: number;
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
  room_id: string;
  code: string;
  question: string;
  category: Category;
  status: "pending";
  inviter: string;
}

export interface RoomHistoryItem {
  room_id: string;
  code: string;
  question: string;
  category: Category;
  status: RoomStatus;
  created_at: string;
  revealed_at: string | null;
  participant_count: number;
  summary: string | null;
  venue_name: string | null;
}

export interface HomeData {
  profile: Profile;
  incoming_requests: number;
  invites: RoomInvite[];
  history: RoomHistoryItem[];
}

export interface SocialData {
  friends: FriendUser[];
  incoming: FriendUser[];
  outgoing: FriendUser[];
}
