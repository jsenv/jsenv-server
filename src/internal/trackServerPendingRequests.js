export const trackServerPendingRequests = (nodeServer) => {
  const pendingClients = new Set()

  const requestListener = (nodeRequest, nodeResponse) => {
    const client = { nodeRequest, nodeResponse }

    pendingClients.add(client)
    nodeResponse.on("finish", () => {
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

        return new Promise((resolve) => {
          if (nodeResponse.finished) {
            resolve()
          } else {
            nodeResponse.on("finish", resolve)
            nodeResponse.on("error", resolve)
            nodeResponse.destroy(reason)
          }
        })
      }),
    )
  }

  return { stop }
}
