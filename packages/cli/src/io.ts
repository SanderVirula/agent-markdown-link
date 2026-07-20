import { once } from "node:events";
import { TextDecoder } from "node:util";

import { AgentMarkdownError } from "@agent-markdown-link/core";

export async function readJsonInput(
  stream: NodeJS.ReadableStream,
  byteLimit: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream as AsyncIterable<unknown>) {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : undefined;
    if (bytes === undefined) throw new AgentMarkdownError("E_INPUT_INVALID");

    const remaining = byteLimit + 1 - total;
    if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
    total += Math.min(bytes.byteLength, Math.max(remaining, 0));
    if (bytes.byteLength > remaining || total > byteLimit) {
      throw new AgentMarkdownError("E_SIZE_LIMIT");
    }
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (error) {
    throw new AgentMarkdownError("E_INPUT_INVALID", { cause: error });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AgentMarkdownError("E_INPUT_INVALID", { cause: error });
  }
}

export async function writeText(stream: NodeJS.WritableStream, text: string): Promise<void> {
  if (stream.write(text)) return;
  await once(stream, "drain");
}
