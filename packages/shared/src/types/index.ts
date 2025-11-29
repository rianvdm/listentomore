// Centralized type exports for the application

export * from './album';
export * from './artist';
export * from './collection';
export * from './track';

// Common utility types
export interface ApiResponse<T> {
  data: T;
  error?: never;
}

export interface ApiError {
  data?: never;
  error: {
    message: string;
    code?: string;
    status: number;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// Query state for consistent loading/error handling
export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

// User type for future multi-user support
export interface User {
  id: string;
  email?: string;
  lastfmUsername?: string;
  discogsUsername?: string;
  spotifyConnected: boolean;
  createdAt: string;
}
