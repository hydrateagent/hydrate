// Types for the inline review system

export interface PendingChange {
  id: string;
  type: 'addition' | 'deletion' | 'replacement';
  from: number; // Character position in document
  to: number;
  originalText: string;
  newText: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ReviewSession {
  filePath: string;
  changes: PendingChange[];
  originalContent: string;
  proposedContent: string;
  isActive: boolean;
}

export interface ReviewResult {
  applied: boolean;
  finalContent: string;
  acceptedCount: number;
  rejectedCount: number;
  message: string;
}

export type ReviewEventType =
  | 'change-accepted'
  | 'change-rejected'
  | 'all-accepted'
  | 'all-rejected'
  | 'review-complete'
  | 'review-cancelled';

export interface ReviewEvent {
  type: ReviewEventType;
  changeId?: string;
  remainingCount: number;
}

export type ReviewEventCallback = (event: ReviewEvent) => void;
