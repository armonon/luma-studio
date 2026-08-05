import { getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MODEL = "gpt-image-2";

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Sign in with ChatGPT to use generative editing.", 401);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return error("Generative editing is not configured on this deployment.", 503);

  const incoming = await request.formData();
  const image = incoming.get("image");
  const mask = incoming.get("mask");
  const promptValue = incoming.get("prompt");
  const operationValue = incoming.get("operation");
  if (!(image instanceof File) || image.size === 0) return error("An image is required.", 400);
  if (image.size > MAX_UPLOAD_BYTES) return error("The image exceeds the 50 MB edit limit.", 413);
  if (mask instanceof File && mask.size > MAX_UPLOAD_BYTES) return error("The mask exceeds the 50 MB edit limit.", 413);

  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";
  if (!prompt || prompt.length > 4000) return error("Enter a prompt up to 4,000 characters.", 400);
  const operation = typeof operationValue === "string" ? operationValue : "fill";
  const operationInstruction: Record<string, string> = {
    fill: "Edit only the guided region and preserve the rest of the image.",
    remove: "Remove the selected subject and reconstruct a natural background.",
    relight: "Preserve composition and identity while changing only lighting as requested.",
    harmonize: "Harmonize lighting, color, shadows, and perspective while preserving composition.",
    upscale: "Increase apparent detail and clarity while preserving the exact composition.",
    expand: "Extend the scene naturally beyond the existing composition.",
  };

  const body = new FormData();
  body.append("model", MODEL);
  body.append("image[]", image, "source.png");
  if (mask instanceof File && mask.size > 0) body.append("mask", mask, "mask.png");
  body.append("prompt", `${operationInstruction[operation] ?? operationInstruction.fill}\n\n${prompt}`);
  body.append("quality", "medium");
  body.append("size", "auto");

  const upstream = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const requestId = upstream.headers.get("x-request-id");
  const payload = await upstream.json() as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };
  if (!upstream.ok) {
    return Response.json(
      { error: payload.error?.message ?? "The image edit failed.", requestId },
      { status: upstream.status },
    );
  }
  const base64 = payload.data?.[0]?.b64_json;
  if (!base64) return error("The image service returned no image.", 502);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-luma-model": MODEL,
      "x-luma-quality": "medium",
      "x-luma-size": "auto",
      ...(requestId ? { "x-openai-request-id": requestId } : {}),
    },
  });
}
