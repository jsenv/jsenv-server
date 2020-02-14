export const trackServerPendingSessions = (nodeServer, { onSessionError }) => {
  const pendingSessions = new Set()

  const sessionListener = (session) => {
    session.on("close", () => {
      pendingSessions.delete(session)
    })
    session.on("error", onSessionError)
    pendingSessions.add(session)
  }

  nodeServer.on("session", sessionListener)

  const stop = async (reason) => {
    nodeServer.removeListener("session", sessionListener)

    await Promise.all(
      Array.from(pendingSessions).map((pendingSession) => {
        return new Promise((resolve, reject) => {
          pendingSession.close((error) => {
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
