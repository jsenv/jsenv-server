import { listenEvent } from "./listenEvent.js"

export const listenClientError = (nodeServer, clientErrorCallback) => {
  if (nodeServer._httpServer) {
    const removeHttpClientError = listenEvent(
      nodeServer._httpServer,
      "clientError",
      clientErrorCallback,
    )
    const removeTlsClientError = listenEvent(
      nodeServer._tlsServer,
      "clientError",
      clientErrorCallback,
    )
    return () => {
      removeHttpClientError()
      removeTlsClientError()
    }
  }
  return listenEvent(nodeServer, "clientError", clientErrorCallback)
}
