// https://github.com/node-fetch/node-fetch/blob/8c197f8982a238b3c345c64b17bfa92e16b4f7c4/src/response.js#L1

import { createRequire } from "module"
import { createCancellationToken, createOperation } from "@jsenv/cancellation"
import { serveFile } from "./serveFile.js"

const require = createRequire(import.meta.url)
const nodeFetch = require("node-fetch")
const AbortController = require("abort-controller")

const { Response } = nodeFetch

export const fetchUrl = async (
  url,
  {
    cancellationToken = createCancellationToken(),
    simplified = false,
    canReadDirectory,
    contentTypeMap,
    cacheStrategy,
    ...options
  } = {},
) => {
  try {
    url = String(new URL(url))
  } catch (e) {
    throw new Error(`fetchUrl first argument must be an absolute url, received ${url}`)
  }

  if (url.startsWith("file://")) {
    const { status, statusText, headers, body } = await serveFile(url, {
      cancellationToken,
      cacheStrategy,
      canReadDirectory,
      contentTypeMap,
      ...options,
    })
    const response = new Response(typeof body === "string" ? Buffer.from(body) : body, {
      url,
      status,
      statusText,
      headers,
    })
    return simplified ? standardResponseToSimplifiedResponse(response) : response
  }

  const response = await createOperation({
    cancellationToken,
    start: () =>
      nodeFetch(url, {
        signal: cancellationTokenToAbortSignal(cancellationToken),
        ...options,
      }),
  })
  return simplified ? standardResponseToSimplifiedResponse(response) : response
}

// https://github.com/bitinn/node-fetch#request-cancellation-with-abortsignal
const cancellationTokenToAbortSignal = (cancellationToken) => {
  const abortController = new AbortController()
  cancellationToken.register((reason) => {
    abortController.abort(reason)
  })
  return abortController.signal
}

const standardResponseToSimplifiedResponse = async (response) => {
  const text = await response.text()
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: responseToHeaders(response),
    body: text,
  }
}

const responseToHeaders = (response) => {
  const headers = {}
  response.headers.forEach((value, name) => {
    headers[name] = value
  })
  return headers
}
