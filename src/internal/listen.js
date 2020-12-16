import { createStoppableOperation } from "@jsenv/cancellation"
import { findFreePort } from "../findFreePort.js"

export const listen = ({ cancellationToken, server, port, portHint, ip }) => {
  return createStoppableOperation({
    cancellationToken,
    start: async () => {
      if (portHint) {
        port = await findFreePort(portHint, { cancellationToken, ip })
      }
      return startListening(server, port, ip)
    },
    stop: () => stopListening(server),
  })
}

const startListening = (server, port, ip) =>
  new Promise((resolve, reject) => {
    server.on("error", reject)
    server.on("listening", () => {
      // in case port is 0 (randomly assign an available port)
      // https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
      resolve(server.address().port)
    })
    server.listen(port, ip)
  })

export const stopListening = (server) =>
  new Promise((resolve, reject) => {
    server.on("error", reject)
    server.on("close", resolve)
    server.close()
  })
