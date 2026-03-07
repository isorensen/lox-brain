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

export interface SearchResult {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  similarity: number;
  updated_at: Date;
}

export interface RecentNote {
  id: string;
  file_path: string;
  title: string | null;
  content: string;
  tags: string[];
  updated_at: Date;
}
