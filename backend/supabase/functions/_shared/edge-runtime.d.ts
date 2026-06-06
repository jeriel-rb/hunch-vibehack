declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
  }

  export const env: Env;

  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare module "openai" {
  type ChatCompletionMessageParam = {
    role: "system" | "user" | "assistant";
    content: string;
  };

  type ChatCompletionCreateParams = {
    model: string;
    temperature?: number;
    messages: ChatCompletionMessageParam[];
    response_format?: {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        strict?: boolean;
        schema: unknown;
      };
    };
  };

  type ChatCompletion = {
    choices: Array<{
      message?: {
        content?: string | null;
        refusal?: string | null;
      };
    }>;
  };

  export default class OpenAI {
    constructor(options: { apiKey: string });
    chat: {
      completions: {
        create(params: ChatCompletionCreateParams): Promise<ChatCompletion>;
      };
    };
  }
}
