export const trackServerPendingRequests = (nodeServer) => {
  const pendingClients = new Set()

  const requestListener = (nodeRequest, nodeResponse) => {
    const client = { nodeRequest, nodeResponse }

    pendingClients.add(client)
    nodeResponse.on("close", () => {
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
      }),
    )
  }

  return { stop }
}
