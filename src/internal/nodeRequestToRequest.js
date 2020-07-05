import { composeCancellationToken, createCancellationSource } from "@jsenv/cancellation"
import { nodeStreamToObservable } from "./nodeStreamToObservable.js"
import { headersFromObject } from "./headersFromObject.js"

export const nodeRequestToRequest = (nodeRequest, { serverCancellationToken, serverOrigin }) => {
  const { method } = nodeRequest
  const { url: ressource } = nodeRequest
  const headers = headersFromObject(nodeRequest.headers)
  const body =
    method === "POST" || method === "PUT" || method === "PATCH"
      ? nodeStreamToObservable(nodeRequest)
      : undefined

  let requestOrigin
  if (nodeRequest.authority) {
    requestOrigin = nodeRequest.connection.encrypted
      ? `https://${nodeRequest.authority}`
      : `http://${nodeRequest.authority}`
  } else if (nodeRequest.headers.host) {
    requestOrigin = nodeRequest.connection.encrypted
      ? `https://${nodeRequest.headers.host}`
      : `http://${nodeRequest.headers.host}`
  } else {
    requestOrigin = serverOrigin
  }

  return Object.freeze({
    // the node request is considered as cancelled if client cancels or server cancels.
    // in case of server cancellation from a client perspective request is not cancelled
    // because client still wants a response. But from a server perspective the production
    // of a response for this request is cancelled
    cancellationToken: composeCancellationToken(
      serverCancellationToken,
      nodeRequestToCancellationToken(nodeRequest),
    ),
    origin: requestOrigin,
    ressource,
    method,
    headers,
    body,
  })
}

const nodeRequestToCancellationToken = (nodeRequest) => {
  const { cancel, token } = createCancellationSource()
  nodeRequest.on("abort", () => {
    cancel("request aborted")
  })
  nodeRequest.on("close", () => {
    cancel("request closed")
  })
  return token
}
