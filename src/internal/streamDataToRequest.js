import { constants } from "http2"
import { composeCancellationToken, createCancellationSource } from "@jsenv/cancellation"
import { nodeStreamToObservable } from "./nodeStreamToObservable.js"
import { headersFromObject } from "./headersFromObject.js"

const { HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH } = constants

export const streamDataToRequest = (
  {
    stream,
    headers,
    // flags
  },
  { serverCancellationToken, serverOrigin },
) => {
  const method = headers[HTTP2_HEADER_METHOD]
  const ressource = headers[HTTP2_HEADER_PATH]

  headers = headersFromObject(headers)
  const body =
    method === "POST" || method === "PUT" || method === "PATCH"
      ? nodeStreamToObservable(stream)
      : undefined

  return Object.freeze({
    // see nodeRequestToRequest.js to udnerstand why we compose cancellation here
    cancellationToken: composeCancellationToken(
      serverCancellationToken,
      http2StreamToCancellationToken(stream),
    ),
    origin: serverOrigin,
    ressource,
    method,
    headers,
    body,
  })
}

const http2StreamToCancellationToken = (http2Stream) => {
  const { cancel, token } = createCancellationSource()
  http2Stream.on("abort", () => {
    cancel("http2stream aborted")
  })
  return token
}
