export const trackServerPendingConnections = (nodeServer, { http2, onConnectionError }) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingConnections(nodeServer, { onConnectionError })
  }
  return trackHttp1ServerPendingConnections(nodeServer, { onConnectionError })
}

// const trackHttp2ServerPendingSessions = () => {}

const trackHttp1ServerPendingConnections = (nodeServer, { onConnectionError }) => {
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
