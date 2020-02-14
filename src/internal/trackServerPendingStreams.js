import { constants } from "http2"

const { NGHTTP2_NO_ERROR } = constants

export const trackServerPendingStreams = (nodeServer) => {
  const pendingClients = new Set()

  const streamListener = (http2Stream, headers, flags) => {
    const client = { http2Stream, headers, flags }

    pendingClients.add(client)
    http2Stream.on("close", () => {
      pendingClients.delete(client)
    })
  }

  nodeServer.on("stream", streamListener)

  const stop = ({
    status,
    // reason
  }) => {
    nodeServer.removeListener("stream", streamListener)

    return Promise.all(
      Array.from(pendingClients).map(({ http2Stream }) => {
        if (http2Stream.sentHeaders === false) {
          http2Stream.respond({ ":status": status }, { endStream: true })
        }

        return new Promise((resolve, reject) => {
          if (http2Stream.closed) {
            resolve()
          } else {
            http2Stream.close(NGHTTP2_NO_ERROR, (error) => {
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
