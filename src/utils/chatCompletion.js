import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractOutputText(resp) {
  const direct = String(resp?.output_text || "").trim();
  if (direct) return direct;

  const output = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
}

export async function generateChatReply(messages) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are a concise travel assistant. Give direct, practical answers. Ask a short follow-up only when needed.",
        },
      ],
    },
    ...messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [{ type: "input_text", text: String(message.content || "") }],
    })),
  ];

  const resp = await client.responses.create({
    model,
    input,
    max_output_tokens: 600,
  });

  const text = extractOutputText(resp);
  if (!text) {
    throw new Error("Assistant returned empty output");
  }

  return text;
}
