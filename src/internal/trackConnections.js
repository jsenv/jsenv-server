export const trackConnections = (nodeServer) => {
  const connections = new Set()

  const connectionListener = (connection) => {
    connection.on("close", () => {
      connections.delete(connection)
    })
    connections.add(connection)
  }

  nodeServer.on("connection", connectionListener)

  const stop = async (reason) => {
    nodeServer.removeListener("connection", connectionListener)

    await Promise.all(
      Array.from(connections).map((connection) => {
        return new Promise((resolve, reject) => {
          connection.on("error", (error) => {
            if (error === reason) {
              return
            }
            throw error
          })
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
      }),
    )
  }

  return { stop }
}
