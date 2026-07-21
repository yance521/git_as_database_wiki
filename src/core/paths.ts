import path from "node:path";

export interface StoryPaths {
  storyDir: string;
  runtimeDir: string;
  currentSessionFile: string;
  sessionsFile: string;
  pendingCommitFile: string;
  installFile: string;
  checkpointsCacheDir: string;
  reviewsDir: string;
  handoffsDir: string;
  hooksDir: string;
  checkpointRef: string;
}

export function getStoryPaths(repoRoot: string): StoryPaths {
  const storyDir = path.join(repoRoot, ".story");
  const runtimeDir = path.join(storyDir, "runtime");
  return {
    storyDir,
    runtimeDir,
    currentSessionFile: path.join(runtimeDir, "current-session.json"),
    sessionsFile: path.join(runtimeDir, "sessions.json"),
    pendingCommitFile: path.join(runtimeDir, "pending-commit.json"),
    installFile: path.join(runtimeDir, "install.json"),
    checkpointsCacheDir: path.join(storyDir, "cache"),
    reviewsDir: path.join(storyDir, "generated", "reviews"),
    handoffsDir: path.join(storyDir, "generated", "handoffs"),
    hooksDir: path.join(storyDir, "hooks"),
    checkpointRef: "refs/heads/story/checkpoints/v1",
  };
}
