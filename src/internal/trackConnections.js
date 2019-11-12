export const trackConnections = (nodeServer) => {
  const connections = new Set()

  const connectionListener = (connection) => {
    connection.on("close", () => {
      connections.delete(connection)
    })
    connections.add(connection)
  }

  nodeServer.on("connection", connectionListener)

  const stop = (reason) => {
    nodeServer.removeListener("connection", connectionListener)

    // should we do this async ?
    connections.forEach((connection) => {
      connection.destroy(reason)
    })
  }

  return { stop }
}
