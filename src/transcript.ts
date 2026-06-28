/**
 * Extracts the transcript text from a minutes-generated markdown file.
 *
 * Minutes writes output like:
 *   ## Transcript
 *   Speaker A: Hello...
 *   ## Action Items
 *   ...
 *
 * Returns the body between "## Transcript" and the next "## " heading (or end of file),
 * stripped of the heading line itself.
 */
export function extractTranscript(markdown: string): string {
  // Find the heading — it may be at the start of the file or preceded by a newline.
  const pattern = /(^|\n)## Transcript\n/;
  const match = pattern.exec(markdown);
  if (!match) return "";

  const afterHeading = markdown.slice(match.index + match[0].length);

  // Stop at the next second-level heading.
  const nextSection = afterHeading.search(/\n## /);
  const body = nextSection === -1 ? afterHeading : afterHeading.slice(0, nextSection);

  return body.trim();
}

/**
 * Reads the `model:` field from YAML frontmatter if present.
 * Returns undefined when the field is absent or empty.
 */
export function extractFrontmatterModel(markdown: string): string | undefined {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!frontmatterMatch) return undefined;

  const modelLine = frontmatterMatch[1]
    .split("\n")
    .find((line) => line.startsWith("model:"));

  if (!modelLine) return undefined;
  const value = modelLine.replace(/^model:\s*/, "").trim();
  return value || undefined;
}
