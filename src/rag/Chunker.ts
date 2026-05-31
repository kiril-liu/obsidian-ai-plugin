import { VectorChunkInput } from "../types";

export class Chunker {
  static chunkMarkdown(
    path: string,
    basename: string,
    mtime: number,
    text: string,
    maxChars: number,
    overlapChars: number,
  ): VectorChunkInput[] {
    const lines = text.split("\n");
    const chunks: VectorChunkInput[] = [];

    let buffer: string[] = [];
    let heading = "";
    let startLine = 1;
    let chunkIndex = 0;

    const push = (endLine: number) => {
      const body = buffer.join("\n").trim();
      if (!body) return;

      chunks.push({
        id: `${path}#${chunkIndex}`,
        path,
        basename,
        mtime,
        chunkIndex,
        text: body,
        heading,
        lineStart: startLine,
        lineEnd: endLine,
      });

      chunkIndex++;

      const overlapText = body.slice(Math.max(0, body.length - overlapChars));
      buffer = overlapText ? [overlapText] : [];
      startLine = endLine;
    };

    lines.forEach((line, index) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) heading = headingMatch[2].trim();

      if (buffer.join("\n").length + line.length > maxChars) {
        push(index + 1);
      }

      buffer.push(line);
    });

    push(lines.length);
    return chunks;
  }
}
