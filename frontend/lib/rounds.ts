// The scripted conversation for a food room. Rounds run client-side (fixed
// questions); answers are saved privately. Follow-up rounds come from the AI.

export interface Chip {
  label: string;
  value: string;
  emoji?: string;
}

export interface ScriptedRound {
  key: "budget" | "style" | "avoid" | "freestyle";
  prompt: string;
  chips?: Chip[];
  freeText?: boolean; // allow a typed answer in addition to chips
  optional?: boolean; // can be skipped
}

export const EAT_ROUNDS: ScriptedRound[] = [
  {
    key: "budget",
    prompt: "First — what's the budget tonight?",
    chips: [
      { label: "$", value: "$" },
      { label: "$$", value: "$$" },
      { label: "$$$", value: "$$$" },
    ],
  },
  {
    key: "style",
    prompt: "Any cuisine you're feeling?",
    chips: [
      { label: "Japanese", value: "Japanese", emoji: "🍜" },
      { label: "Western", value: "Western", emoji: "🍔" },
      { label: "Chinese", value: "Chinese", emoji: "🥟" },
      { label: "Surprise me", value: "anything" },
    ],
    freeText: true,
  },
  {
    key: "avoid",
    prompt: "Anything you'd rather avoid?",
    chips: [
      { label: "Too spicy", value: "too spicy" },
      { label: "Too heavy", value: "too heavy" },
      { label: "Nothing, I'm open", value: "nothing" },
    ],
    freeText: true,
  },
  {
    key: "freestyle",
    prompt: "Last one — anything else on your mind? (optional)",
    freeText: true,
    optional: true,
  },
];
