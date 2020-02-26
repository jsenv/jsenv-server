export const trackServerPendingConnections = (nodeServer, { onConnectionError }) => {
  const pendingConnections = new Set()

  const connectionListener = (connection) => {
    connection.on("close", () => {
      pendingConnections.delete(connection)
    })
    if (onConnectionError) {
      connection.on("error", (error) => {
        onConnectionError(error, connection)
      })
    }
    pendingConnections.add(connection)
  }

  nodeServer.on("connection", connectionListener)

  const stop = async (reason) => {
    nodeServer.removeListener("connection", connectionListener)

    await Promise.all(
      Array.from(pendingConnections).map((pendingConnection) => {
        return new Promise((resolve, reject) => {
          pendingConnection.destroy(reason, (error) => {
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
