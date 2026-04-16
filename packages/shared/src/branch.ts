export interface Branch {
  id: string;
  sessionId: string;
  parentSnapshotId: string;
  /** Current snapshot ID */
  snapshotId: string;
  name: string;
  createdAt: string;
}

export interface BranchRequest {
  /** Snapshot ID to fork from */
  snapshotId: string;
  name?: string;
}

export interface BranchTreeNode {
  snapshotId: string;
  parentSnapshotId?: string;
  children: BranchTreeNode[];
  label?: string;
  createdAt: string;
}
