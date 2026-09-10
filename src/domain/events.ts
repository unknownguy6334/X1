export type WorkflowEventName =
  | 'workflow.reset'
  | 'workflow.home'
  | 'workflow.setup'
  | 'ocr.started'
  | 'ocr.completed'
  | 'ocr.partial-success'
  | 'ocr.failed'
  | 'ocr.cancelled'
  | 'review.opened'
  | 'review.saved'
  | 'review.discarded'
  | 'catalog.changed'
  | 'optimizer.started'
  | 'optimizer.completed'
  | 'optimizer.partial'
  | 'optimizer.cancelled'
  | 'optimizer.failed'
  | 'results.stale'
  | 'results.opened'
  | 'export.started'
  | 'export.completed'
  | 'export.failed';

export interface WorkflowEvent {
  name: WorkflowEventName;
  at: number;
  generationId: string;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export class WorkflowEventBuffer {
  private readonly maxSize: number;
  private readonly events: WorkflowEvent[] = [];
  constructor(maxSize = 100) { this.maxSize = Math.max(10, Math.min(maxSize, 500)); }
  push(event: WorkflowEvent): void { this.events.push({ ...event, details: event.details ? { ...event.details } : undefined }); if (this.events.length > this.maxSize) this.events.splice(0, this.events.length - this.maxSize); }
  snapshot(): WorkflowEvent[] { return this.events.map((event) => ({ ...event, details: event.details ? { ...event.details } : undefined })); }
  clear(): void { this.events.length = 0; }
}
