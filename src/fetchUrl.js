// https://github.com/node-fetch/node-fetch/blob/8c197f8982a238b3c345c64b17bfa92e16b4f7c4/src/response.js#L1

import { createRequire } from "module"
import { Agent } from "https"
import { createCancellationToken } from "@jsenv/cancellation"
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
    ignoreHttpsError = false,
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

  if (url.startsWith("data:")) {
    const { mediaType, base64Flag, data } = parseDataUrl(url)
    const body = base64Flag ? Buffer.from(data, "base64") : Buffer.from(data)
    const response = new Response(body, {
      url,
      status: 200,
      headers: {
        "content-type": mediaType,
      },
    })
    return simplified ? standardResponseToSimplifiedResponse(response) : response
  }

  // cancellation might be requested early, abortController does not support that
  // so we have to throw if requested right away
  cancellationToken.throwIfRequested()

  // https://github.com/bitinn/node-fetch#request-cancellation-with-abortsignal
  const abortController = new AbortController()

  let cancelError
  cancellationToken.register((reason) => {
    cancelError = reason
    abortController.abort(reason)
  })

  let response
  try {
    response = await nodeFetch(url, {
      signal: abortController.signal,
      ...(ignoreHttpsError && url.startsWith("https")
        ? {
            agent: new Agent({
              rejectUnauthorized: false,
            }),
          }
        : {}),
      ...options,
    })
  } catch (e) {
    if (e.message.includes("reason: connect ECONNRESET")) {
      if (cancelError) {
        throw cancelError
      }
      throw e
    }
    if (e.name === "AbortError") {
      if (cancelError) {
        throw cancelError
      }
      throw e
    }
    throw e
  }

  return simplified ? standardResponseToSimplifiedResponse(response) : response
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

const parseDataUrl = (dataUrl) => {
  const afterDataProtocol = dataUrl.slice("data:".length)
  const commaIndex = afterDataProtocol.indexOf(",")
  const beforeComma = afterDataProtocol.slice(0, commaIndex)

  let mediaType
  let base64Flag
  if (beforeComma.endsWith(`;base64`)) {
    mediaType = beforeComma.slice(0, -`;base64`.length)
    base64Flag = true
  } else {
    mediaType = beforeComma
    base64Flag = false
  }

  const afterComma = afterDataProtocol.slice(commaIndex + 1)
  return {
    mediaType: mediaType === "" ? "text/plain;charset=US-ASCII" : mediaType,
    base64Flag,
    data: afterComma,
  }
}
