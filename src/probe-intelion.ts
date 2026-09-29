type ProbeResult = {
  capability: string
  status: "supported" | "unsupported" | "failed" | "not-listed"
  detail: string
}

const apiKey = process.env.INTELION_API_KEY
const baseUrl = process.env.INTELION_API_BASE_URL ?? "https://rus.aiapi.intelion.cloud/v1"
const model = process.env.INTELION_MODEL ?? "qwen3.8-27b"

if (!apiKey) {
  console.error(
    "INTELION_API_KEY is not set. Export it in the current shell; never paste it into source files."
  )
  process.exitCode = 1
} else {
  const results: ProbeResult[] = []

  const modelResult = await probeModelList()
  results.push(modelResult)

  const textResult = await probeText()
  results.push(textResult)

  if (textResult.status === "supported") {
    results.push(await probeImageInput())
    results.push(await probeJsonSchema())
  } else {
    results.push({
      capability: "image_url",
      status: "failed",
      detail: "Skipped because the baseline text request failed.",
    })
    results.push({
      capability: "json_schema",
      status: "failed",
      detail: "Skipped because the baseline text request failed.",
    })
  }

  console.table(results)
  if (results.some((result) => result.status === "failed")) process.exitCode = 1
}

async function probeModelList(): Promise<ProbeResult> {
  const response = await request("/models", { method: "GET" })
  if (!response.ok) {
    return resultFromFailure("model-list", response)
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string; capabilities?: unknown; region?: unknown }>
  }
  const entry = payload.data?.find((item) => item.id === model)

  return entry
    ? {
        capability: "model-list",
        status: "supported",
        detail: `${model} is listed for this key and endpoint.`,
      }
    : {
        capability: "model-list",
        status: "not-listed",
        detail: `${model} was not returned by /models for this key and region.`,
      }
}

async function probeText(): Promise<ProbeResult> {
  const response = await request("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Reply with exactly: INTELION_TEXT_OK" }],
    }),
  })

  if (!response.ok) return resultFromFailure("text", response)

  const payload = (await response.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content ?? ""
  return {
    capability: "text",
    status: content.includes("INTELION_TEXT_OK") ? "supported" : "failed",
    detail: compact(content || `No message content; finish_reason=${payload.choices?.[0]?.finish_reason ?? "unknown"}.`),
  }
}

async function probeImageInput(): Promise<ProbeResult> {
  // A valid 1×1 PNG. The probe checks protocol acceptance, not visual quality.
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nM8AAAAASUVORK5CYII="
  const response = await request("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "If the image input is accepted, reply with JSON: {\"accepted\":true}." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  })

  if (!response.ok) return resultFromFailure("image_url", response)

  return {
    capability: "image_url",
    status: "supported",
    detail: "The endpoint accepted an OpenAI-style image_url content block.",
  }
}

async function probeJsonSchema(): Promise<ProbeResult> {
  const response = await request("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Return a JSON object with accepted=true." }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "capability_probe",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { accepted: { type: "boolean" } },
            required: ["accepted"],
          },
        },
      },
    }),
  })

  if (!response.ok) return resultFromFailure("json_schema", response, "unsupported")

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content ?? ""
  try {
    const parsed = JSON.parse(content) as { accepted?: unknown }
    return {
      capability: "json_schema",
      status: parsed.accepted === true && Object.keys(parsed).length === 1 ? "supported" : "failed",
      detail: compact(content),
    }
  } catch {
    return {
      capability: "json_schema",
      status: "failed",
      detail: `The endpoint responded, but content was not valid JSON: ${compact(content)}`,
    }
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(60_000),
  })
}

async function resultFromFailure(
  capability: string,
  response: Response,
  status: ProbeResult["status"] = "failed"
): Promise<ProbeResult> {
  const body = compact(await response.text())
  return {
    capability,
    status,
    detail: `HTTP ${response.status}: ${body || response.statusText}`,
  }
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 300)
}
