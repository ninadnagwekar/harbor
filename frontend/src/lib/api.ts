export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

let onUnauthorized = () => {}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

function localDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase()
  let url = path
  if (method === "GET" && !url.includes("as_of=")) {
    url += `${url.includes("?") ? "&" : "?"}as_of=${localDate()}`
  }
  const headers = new Headers(options.headers)
  if (method !== "GET" && method !== "HEAD") headers.set("X-Harbor-Request", "1")
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  let response: Response
  try {
    response = await fetch(url, { ...options, headers, credentials: "include" })
  } catch {
    throw new ApiError(0, "Harbor could not reach the server.")
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { detail?: unknown }) : {}
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong. Try again."
    if (response.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized()
    throw new ApiError(response.status, detail)
  }
  return data as T
}

export async function download(path: string, filename: string) {
  const url = path.includes("as_of=") ? path : `${path}${path.includes("?") ? "&" : "?"}as_of=${localDate()}`
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) {
    const text = await response.text()
    let detail = "Could not download that file."
    try {
      const data = JSON.parse(text) as { detail?: unknown }
      if (typeof data.detail === "string") detail = data.detail
    } catch {
      /* the body was not JSON */
    }
    throw new ApiError(response.status, detail)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = filename
  link.click()
  URL.revokeObjectURL(objectUrl)
}
