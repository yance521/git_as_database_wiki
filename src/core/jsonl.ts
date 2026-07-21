export type TranscriptRecord = Record<string, unknown>;

export function normalizeTranscript(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function parseTranscript(raw: string): TranscriptRecord[] {
  const normalized = normalizeTranscript(raw);
  if (!normalized) return [];

  return normalized
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`line ${index + 1} is not valid JSON`);
      }
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        throw new Error(`line ${index + 1} must be a JSON object`);
      }
      return value as TranscriptRecord;
    });
}
