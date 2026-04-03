import { Pool } from 'pg';
import { DEFAULT_CONFIG } from '@lox-brain/shared';

const DB = DEFAULT_CONFIG.database!;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createPool(config?: Partial<DbConfig>): Pool {
  const password = config?.password ?? process.env.PG_PASSWORD;
  if (!password) {
    throw new Error('PG_PASSWORD environment variable or explicit password is required');
  }

  return new Pool({
    host: config?.host ?? process.env.DB_HOST ?? DB.host,
    port: config?.port ?? parseInt(process.env.DB_PORT ?? String(DB.port), 10),
    database: config?.database ?? process.env.DB_NAME ?? DB.name,
    user: config?.user ?? process.env.DB_USER ?? DB.user,
    password,
    // SSL omitted: PostgreSQL listens on localhost only (Zero Trust — no public IP).
  });
}
