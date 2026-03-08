export interface NoteMetadata {
  title: string | null;
  tags: string[];
  content: string;
}

export interface NoteRow {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  embedding: number[];
  file_hash: string;
}

export interface SearchOptions {
  limit: number;
  offset: number;
  includeContent: boolean;
  contentPreviewLength: number; // 0 = full content, >0 = truncate at N chars
}

export interface PaginatedResult<T> {
  results: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchResult {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  similarity: number;
  updated_at: Date;
}

export interface RecentNote {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  updated_at: Date;
}
