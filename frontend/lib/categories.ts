import { Utensils, Plane, Film, Sparkles, type LucideIcon } from "lucide-react";
import type { Category } from "@/lib/types";

export interface CategoryMeta {
  key: Category;
  label: string;
  sub: string;
  icon: LucideIcon;
  defaultQuestion: string;
  pro: boolean; // locked behind Pro for now
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "eat", label: "Where to eat", sub: "the daily one", icon: Utensils, defaultQuestion: "Where should we eat?", pro: false },
  { key: "travel", label: "Where to travel", sub: "the group-trip chat", icon: Plane, defaultQuestion: "Where should we travel?", pro: true },
  { key: "watch", label: "What to watch", sub: "movie-night standoff", icon: Film, defaultQuestion: "What should we watch?", pro: true },
  { key: "other", label: "Something else", sub: "any group call", icon: Sparkles, defaultQuestion: "What should we decide?", pro: true },
];

export function getCategory(key: string): CategoryMeta | undefined {
  return CATEGORIES.find((c) => c.key === key);
}
