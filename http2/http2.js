// it kinda works but if you reload a browser page
// you got a WRITE_AFTER_END error on the http2Stream instance
// as if it was reused after being ended, don't know why
// for now we disable it and count on https://nodejs.org/api/http2.html#http2_compatibility_api

import { constants } from "http2"
import { Stream, Writable, Readable } from "stream"
import { composeCancellationToken, createCancellationSource } from "@jsenv/cancellation"
import { isObservable, subscribe } from "../src/internal/observable.js"
import { nodeStreamToObservable } from "../src/internal/nodeStreamToObservable.js"
import { valueToObservable } from "../src/internal/valueToObservable.js"
import { headersFromObject } from "../src/internal/headersFromObject.js"

const { NGHTTP2_NO_ERROR } = constants

export const trackServerPendingStreams = (nodeServer) => {
  const pendingClients = new Set()

  const streamListener = (http2Stream, headers, flags) => {
    const client = { http2Stream, headers, flags }

    pendingClients.add(client)
    http2Stream.on("close", () => {
      pendingClients.delete(client)
    })
  }

  nodeServer.on("stream", streamListener)

  const stop = ({
    status,
    // reason
  }) => {
    nodeServer.removeListener("stream", streamListener)

    return Promise.all(
      Array.from(pendingClients).map(({ http2Stream }) => {
        if (http2Stream.sentHeaders === false) {
          http2Stream.respond({ ":status": status }, { endStream: true })
        }

        return new Promise((resolve, reject) => {
          if (http2Stream.closed) {
            resolve()
          } else {
            http2Stream.close(NGHTTP2_NO_ERROR, (error) => {
              if (error) {
                reject(error)
              } else {
                resolve()
              }
            })
          }
        })
      }),
    )
  }

  return { stop }
}

export const trackServerPendingSessions = (nodeServer, { onSessionError }) => {
  const pendingSessions = new Set()

  const sessionListener = (session) => {
    session.on("close", () => {
      pendingSessions.delete(session)
    })
    session.on("error", onSessionError)
    pendingSessions.add(session)
  }

  nodeServer.on("session", sessionListener)

  const stop = async (reason) => {
    nodeServer.removeListener("session", sessionListener)

    await Promise.all(
      Array.from(pendingSessions).map((pendingSession) => {
        return new Promise((resolve, reject) => {
          pendingSession.close((error) => {
            if (error) {
              if (error === reason || error.code === "ENOTCONN") {
                resolve()
              } else {
                reject(error)
              }
            } else {
              resolve()
            }
          })
        })
      }),
    )
  }

  return { stop }
}

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

export const populateHttp2Stream = (
  http2Stream,
  {
    status,
    // statusText,
    headers,
    body,
    bodyEncoding,
  },
  { ignoreBody } = {},
) => {
  const nodeHeaders = {
    ...headersToNodeHeaders(headers),
    ":status": status,
  }

  if (ignoreBody) {
    http2Stream.respond(nodeHeaders, { endStream: true })
    return
  }
  http2Stream.respond(nodeHeaders)

  if (bodyEncoding) {
    http2Stream.setEncoding(bodyEncoding)
  }

  const observable = bodyToObservable(body)
  const subscription = subscribe(observable, {
    next: (data) => {
      http2Stream.end(data)
    },
    error: (value) => {
      http2Stream.emit("error", value)
    },
    complete: () => {
      // https://nodejs.org/api/http2.html#http2_http2stream_respond_headers_options
      http2Stream.destroy()
    },
  })
  http2Stream.once("close", () => {
    // close body in case prematurely closed
    // while body is writing
    // it may happen in case of server sent event
    // where body is kept open to write to client
    // and the browser is reloaded or closed for instance
    subscription.unsubscribe()
  })
}

const mapping = {
  // "content-type": "Content-Type",
  // "last-modified": "Last-Modified",
}

const headersToNodeHeaders = (headers) => {
  const nodeHeaders = {}

  Object.keys(headers).forEach((name) => {
    const nodeHeaderName = name in mapping ? mapping[name] : name
    nodeHeaders[nodeHeaderName] = headers[name]
  })

  return nodeHeaders
}

const bodyToObservable = (body) => {
  if (isObservable(body)) return body
  if (isNodeStream(body)) return nodeStreamToObservable(body)
  return valueToObservable(body)
}

const isNodeStream = (value) => {
  if (value === undefined) return false
  if (value instanceof Stream) return true
  if (value instanceof Writable) return true
  if (value instanceof Readable) return true
  return false
}
