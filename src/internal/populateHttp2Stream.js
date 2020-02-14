import { Stream, Writable, Readable } from "stream"
import { isObservable, subscribe } from "./observable.js"
import { nodeStreamToObservable } from "./nodeStreamToObservable.js"
import { valueToObservable } from "./valueToObservable.js"

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
