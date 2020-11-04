export const trackServerPendingRequests = (nodeServer, { http2 }) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingRequests(nodeServer)
  }
  return trackHttp1ServerPendingRequests(nodeServer)
}

// const trackHttp2ServerPendingStreams = () => {}

const trackHttp1ServerPendingRequests = (nodeServer) => {
  const pendingClients = new Set()

  const requestListener = (nodeRequest, nodeResponse) => {
    const client = { nodeRequest, nodeResponse }

    pendingClients.add(client)
    nodeResponse.once("close", () => {
      pendingClients.delete(client)
    })
  }

  nodeServer.on("request", requestListener)

  const stop = ({ status, reason }) => {
    nodeServer.removeListener("request", requestListener)

    return Promise.all(
      Array.from(pendingClients).map(({ nodeResponse }) => {
        if (nodeResponse.headersSent === false) {
          nodeResponse.writeHead(status, reason)
        }

        // http2
        if (nodeResponse.close) {
          return new Promise((resolve, reject) => {
            if (nodeResponse.closed) {
              resolve()
            } else {
              nodeResponse.close((error) => {
                if (error) {
                  reject(error)
                } else {
                  resolve()
                }
              })
            }
          })
        }

        // http
        return new Promise((resolve) => {
          if (nodeResponse.destroyed) {
            resolve()
          } else {
            nodeResponse.once("close", () => {
              resolve()
            })
            nodeResponse.destroy()
          }
        })
      }),
    )
  }

  return { stop }
}
