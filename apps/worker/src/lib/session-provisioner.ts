import type { ContreeClient } from "@opencode-cloud/contree-client";
import type { Session } from "@opencode-cloud/shared";

/**
 * SessionProvisioner orchestrates the creation and management of opencode sessions
 * in Contree sandboxes. This is where all Contree API calls are centralized.
 */

// Configuration for the base opencode image
const BASE_IMAGE_CONFIG = {
  // Pre-built image with opencode installed
  // In production, this would be a Docker image built and pushed to a registry
  reference: "docker.io/opencode/opencode-cloud-base:latest",
  // Fallback: if the image doesn't exist, build it from scratch by running:
  // - apt-get update && apt-get install -y nodejs npm git
  // - npm install -g opencode
  buildScript: `
    apt-get update && apt-get install -y nodejs npm git curl &&
    npm install -g bun &&
    npm install -g opencode
  `,
};

const OPENCODE_SERVE_PORT = 3000;
const OPENCODE_SERVE_COMMAND = `opencode serve --port ${OPENCODE_SERVE_PORT}`;

/**
 * Provision a new session: import image, run opencode serve, capture the result
 */
export async function provisionSession(
  contree: ContreeClient,
  options: {
    repoUrl?: string;
    imageId?: string;
  } = {},
): Promise<{
  contreeInstanceId: string;
  snapshotId: string;
  baseImageId: string;
}> {
  // Step 1: Import or get the base image
  const baseImageId =
    options.imageId ||
    (await getOrImportBaseImage(contree));

  // Step 2: (Optional) Clone repo if provided
  let workingImageId = baseImageId;
  if (options.repoUrl) {
    workingImageId = await cloneRepoIntoImage(
      contree,
      baseImageId,
      options.repoUrl,
    );
  }

  // Step 3: Run opencode serve in the sandbox (non-disposable to create snapshot)
  const runResult = await contree.run({
    image_id: workingImageId,
    shell: OPENCODE_SERVE_COMMAND,
    disposable: false, // Non-disposable creates a new snapshot
    timeout_seconds: 30, // Give it time to start and stabilize
  });

  // The snapshot ID is the new image_id returned
  // This is the checkpoint we can fork from later
  const snapshotId = runResult.image_id;
  const contreeInstanceId = runResult.operation_id; // Track the operation for debugging

  return {
    contreeInstanceId,
    snapshotId,
    baseImageId,
  };
}

/**
 * Snapshot the current state of a session (checkpoint)
 * Returns the snapshot ID for branching
 */
export async function snapshotSession(
  contree: ContreeClient,
  currentImageId: string,
): Promise<string> {
  // A snapshot is created by running a no-op non-disposable command
  const result = await contree.run({
    image_id: currentImageId,
    shell: "true", // No-op command
    disposable: false,
    timeout_seconds: 5,
  });

  return result.image_id; // The new snapshot ID
}

/**
 * Branch from a snapshot: fork into a new sandbox instance
 * In Contree, branching is implicit — just run commands on the snapshot image ID
 */
export async function branchFromSnapshot(
  contree: ContreeClient,
  snapshotId: string,
  _branchName?: string,
): Promise<{
  branchImageId: string;
}> {
  // Branching in Contree is stateless — the snapshot is the checkpoint
  // Each command execution from a snapshot creates a new image
  // So "branching" just means we'll reference this snapshotId for future operations
  // The branchImageId IS the snapshotId (it's already immutable)

  return {
    branchImageId: snapshotId,
  };
}

/**
 * Rollback to a snapshot: create a new sandbox from the snapshot image
 */
export async function rollbackToSnapshot(
  contree: ContreeClient,
  snapshotId: string,
): Promise<{
  restoredImageId: string;
}> {
  // Rollback in Contree is implicit — just use the snapshot image ID again
  // Run a no-op to stabilize the state
  const result = await contree.run({
    image_id: snapshotId,
    shell: "true",
    disposable: false,
    timeout_seconds: 5,
  });

  return {
    restoredImageId: result.image_id,
  };
}

/**
 * Destroy a session by marking it as destroyed
 * (Contree sandboxes are ephemeral; they'll be garbage collected)
 */
export async function destroySession(
  _contree: ContreeClient,
  _sessionImageId: string,
): Promise<void> {
  // No explicit cleanup needed in Contree
  // Sandboxes are ephemeral and will be cleaned up by Contree's GC
  // Just mark the session as destroyed in our metadata
}

/**
 * Get or import the base opencode image
 */
async function getOrImportBaseImage(contree: ContreeClient): Promise<string> {
  // TODO: Check if the image is already imported (query by tag)
  // For now, always import fresh to avoid caching issues during development
  const operation = await contree.importImage(BASE_IMAGE_CONFIG.reference);

  // Wait for the import to complete
  // importImage returns an operation ID, not the image ID directly
  const finalOp = await contree.waitOperation(operation.id);

  // The imported image ID should be in the result
  // This is a bit unclear from Contree docs; might need to adjust
  const importedImageId = (finalOp.result as { image_id?: string })?.image_id;
  if (!importedImageId) {
    throw new Error(
      `Failed to import base image: no image_id in operation result`,
    );
  }

  return importedImageId;
}

/**
 * Clone a git repo into a sandbox image (creates a new image with repo contents)
 */
async function cloneRepoIntoImage(
  contree: ContreeClient,
  baseImageId: string,
  repoUrl: string,
): Promise<string> {
  // Run git clone in the sandbox (non-disposable to create new snapshot)
  const result = await contree.run({
    image_id: baseImageId,
    shell: `git clone ${repoUrl} /workspace && cd /workspace`,
    disposable: false,
    timeout_seconds: 60, // Clone might take a while
  });

  if (result.exit_code !== 0) {
    throw new Error(
      `Failed to clone repo: ${result.stderr || result.stdout}`,
    );
  }

  return result.image_id; // New snapshot with cloned repo
}

/**
 * Update session metadata with provisioning results
 */
export function updateSessionWithProvisioningResult(
  session: Session,
  provisioningResult: Awaited<ReturnType<typeof provisionSession>>,
): Session {
  return {
    ...session,
    status: "running",
    contreeInstanceId: provisioningResult.contreeInstanceId,
    snapshotId: provisioningResult.snapshotId,
    updatedAt: new Date().toISOString(),
  };
}
