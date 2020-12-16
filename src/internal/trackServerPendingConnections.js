import { listenEvent } from "./listenEvent.js"

export const trackServerPendingConnections = (nodeServer, { http2 }) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerPendingConnections(nodeServer)
  }
  return trackHttp1ServerPendingConnections(nodeServer)
}

// const trackHttp2ServerPendingSessions = () => {}

const trackHttp1ServerPendingConnections = (nodeServer) => {
  const pendingConnections = new Set()

  const removeConnectionListener = listenEvent(nodeServer, "connection", (connection) => {
    pendingConnections.add(connection)
    listenEvent(
      connection,
      "close",
      () => {
        pendingConnections.delete(connection)
      },
      { once: true },
    )
  })

  const stop = async (reason) => {
    removeConnectionListener()
    const pendingConnectionsArray = Array.from(pendingConnections)
    pendingConnections.clear()

    await Promise.all(
      pendingConnectionsArray.map(async (pendingConnection) => {
        await destroyConnection(pendingConnection, reason)
      }),
    )
  }

  return { stop }
}

const destroyConnection = (connection, reason) => {
  return new Promise((resolve, reject) => {
    connection.destroy(reason, (error) => {
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
}
