import { Stream, Writable, Readable } from "stream"
import { isObservable, observableFromValue } from "./observable.js"
import { nodeStreamToObservable } from "./nodeStreamToObservable.js"

export const populateNodeResponse = (
  nodeResponse,
  { status, statusText, headers, body, bodyEncoding },
  { cancellationToken, ignoreBody, ignoreStatusText, ignoreConnectionHeader } = {},
) => {
  const nodeHeaders = headersToNodeHeaders(headers, { ignoreConnectionHeader })
  // nodejs strange signature for writeHead force this
  // https://nodejs.org/api/http.html#http_response_writehead_statuscode_statusmessage_headers
  if (statusText === undefined || ignoreStatusText) {
    nodeResponse.writeHead(status, nodeHeaders)
  } else {
    nodeResponse.writeHead(status, statusText, nodeHeaders)
  }
  if (ignoreBody) {
    nodeResponse.end()
    return
  }

  if (bodyEncoding) {
    nodeResponse.setEncoding(bodyEncoding)
  }

  const observable = bodyToObservable(body)
  const subscription = observable.subscribe({
    next: (data) => {
      try {
        nodeResponse.write(data)
      } catch (e) {
        // Something inside Node.js sometimes puts stream
        // in a state where .write() throw despites nodeResponse.destroyed
        // being undefined and "close" event not being emitted.
        // I have tested if we are the one calling destroy
        // (I have commented every .destroy() call)
        // but issue still occurs
        // For the record it's "hard" to reproduce but can be by running
        // a lot of tests against a browser in the context of @jsenv/core testing
        if (e.code === "ERR_HTTP2_INVALID_STREAM") {
          return
        }
        throw e
      }
    },
    error: (value) => {
      nodeResponse.emit("error", value)
    },
    complete: () => {
      nodeResponse.end()
    },
  })
  const cancellation = cancellationToken.register(() => {
    cancellation.unregister()
    subscription.unsubscribe()
    nodeResponse.destroy()
  })
  nodeResponse.once("close", () => {
    cancellation.unregister()
    // close body in case nodeResponse is prematurely closed
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

const headersToNodeHeaders = (headers, { ignoreConnectionHeader }) => {
  const nodeHeaders = {}

  Object.keys(headers).forEach((name) => {
    if (name === "connection" && ignoreConnectionHeader) return
    const nodeHeaderName = name in mapping ? mapping[name] : name
    nodeHeaders[nodeHeaderName] = headers[name]
  })

  return nodeHeaders
}

const bodyToObservable = (body) => {
  if (isObservable(body)) {
    return body
  }

  if (isNodeStream(body)) {
    return nodeStreamToObservable(body)
  }

  return observableFromValue(body)
}

const isNodeStream = (value) => {
  if (value === undefined) {
    return false
  }

  if (value instanceof Stream || value instanceof Writable || value instanceof Readable) {
    return true
  }

  return false
}
