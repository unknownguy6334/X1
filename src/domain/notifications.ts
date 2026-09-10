export type WorkflowAnnouncementKind = 'ocr' | 'workflow' | 'search' | 'export' | 'reset';

export interface WorkflowAnnouncement {
  kind: WorkflowAnnouncementKind;
  message: string;
  createdAt: number;
}

export function createAnnouncement(kind: WorkflowAnnouncementKind, message: string): WorkflowAnnouncement {
  return { kind, message, createdAt: Date.now() };
}
