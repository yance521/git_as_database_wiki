const STORY_TRAILER_KEYS = [
  "Story-Checkpoint",
  "Story-Session",
  "Story-Session-SHA",
  "Story-Content-Hash",
] as const;

export type StoryTrailerKey = (typeof STORY_TRAILER_KEYS)[number];
export type TrailerMap = Record<string, string[]>;

export function parseTrailers(message: string): TrailerMap {
  const trailers: TrailerMap = {};
  for (const line of message.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!match || !STORY_TRAILER_KEYS.includes(match[1] as StoryTrailerKey)) {
      continue;
    }
    const key = match[1];
    trailers[key] ??= [];
    trailers[key].push(match[2]);
  }
  return trailers;
}

export function appendMissingTrailers(
  message: string,
  session: { session_id: string; session_ids?: string[]; session_sha: string },
  checkpointId: string,
  contentHash: string,
): string {
  const sessionIds = session.session_ids?.length
    ? session.session_ids
    : [session.session_id];
  const desired: Array<[StoryTrailerKey, string]> = [
    ["Story-Checkpoint", checkpointId],
    ...sessionIds.map((sessionId): [StoryTrailerKey, string] => [
      "Story-Session",
      sessionId,
    ]),
    ["Story-Session-SHA", session.session_sha],
    ["Story-Content-Hash", contentHash],
  ];
  const existing = parseTrailers(message);
  const missing = desired.filter(
    ([key, value]) => !(existing[key] ?? []).includes(value),
  );
  if (missing.length === 0) return message;

  const normalized = message.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return `${normalized}\n\n${missing
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}
