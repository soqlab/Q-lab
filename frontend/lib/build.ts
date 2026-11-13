// Which commit this dashboard was built from. next.config.mjs sets NEXT_PUBLIC_QLAB_COMMIT at build
// time (RENDER_GIT_COMMIT on Render, GITHUB_SHA in CI, else `git rev-parse HEAD`); it is empty when
// none of those is available, and the app then says the commit is unknown rather than guessing.

const SHA = /^[0-9a-f]{40}$/;

const rawCommit = (process.env.NEXT_PUBLIC_QLAB_COMMIT || "").toLowerCase();

export const FRONTEND_COMMIT: string | null = SHA.test(rawCommit) ? rawCommit : null;
export const FRONTEND_COMMIT_TIME: string | null = process.env.NEXT_PUBLIC_QLAB_COMMIT_TIME || null;
export const SOURCE_REPO = "https://github.com/soqlab/Q-lab";

export function commitUrl(sha: string): string {
  return `${SOURCE_REPO}/commit/${encodeURIComponent(sha)}`;
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

/** What GET /api/v1/build returns: the commit the backend was built from. */
export type BackendBuild = { commit: string | null; commit_time: string | null; version: string; source: string };

export function isBackendBuild(d: unknown): d is BackendBuild {
  if (!d || typeof d !== "object") return false;
  const b = d as Record<string, unknown>;
  return (b.commit === null || (typeof b.commit === "string" && SHA.test(b.commit))) && typeof b.version === "string";
}
