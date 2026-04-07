/**
 * Ambient module declaration for @lox-brain/team.
 *
 * Core uses a dynamic `await import('@lox-brain/team')` at runtime (team mode
 * only) so it cannot have a direct package.json dependency — that would create
 * a circular dependency since team already depends on core.  This declaration
 * gives TypeScript enough type information to type-check the import without
 * requiring the package to appear in core's dependency graph.
 *
 * Keep in sync with packages/team/src/index.ts.
 */
import type { LoxConfig } from '@lox-brain/shared';

declare module '@lox-brain/team' {
  export interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }

  export interface TeamRegistrationResult {
    success: boolean;
    org?: string;
    peersRegistered?: number;
    tools?: Tool[];
    error?: string;
  }

  export function registerTeamFeatures(
    server: unknown,
    config: LoxConfig,
    tools: Tool[],
    publicKey: string,
    options?: {
      getClientIp?: () => string | null;
      dbClient?: {
        listRecent(options?: unknown): Promise<unknown>;
        searchByAuthor(author: string, query?: string, options?: unknown): Promise<unknown>;
      };
    },
  ): Promise<TeamRegistrationResult>;
}
