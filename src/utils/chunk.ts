export function chunkText(text: string, maxLength: number = 1900): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) { chunks.push(remaining); break; }
    const slice = remaining.slice(0, maxLength);
    const lastNewline = slice.lastIndexOf('\n');
    const cutAt = lastNewline > 0 ? lastNewline + 1 : maxLength;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  return chunks;
}
