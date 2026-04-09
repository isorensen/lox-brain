export interface NoteMetadata {
  title: string | null;
  tags: string[];
  content: string;
  created_by?: string;
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

// --- Tasks ---

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export const TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'done', 'cancelled'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high'];

export interface TaskRow {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  tags: string[];
  project_context: string | null;
  created_by: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskListOptions {
  status?: TaskStatus;
  priority?: TaskPriority;
  project_context?: string;
  tags?: string[];
  due_before?: string;
  limit?: number;
  offset?: number;
}
