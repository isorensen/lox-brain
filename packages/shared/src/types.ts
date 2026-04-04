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
  chunk_index: number;
  created_by?: string;
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
  created_by?: string;
}

export interface RecentNote {
  id: string;
  file_path: string;
  title: string | null;
  content?: string;
  tags: string[];
  updated_at: Date;
  created_by?: string;
}
