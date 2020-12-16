/**

https://stackoverflow.com/a/42019773/2634179

*/

import http from "http"
import net from "net"
import { listenEvent } from "./listenEvent.js"

export const createPolyglotServer = async ({
  http2 = false,
  http1Allowed = true,
  privateKey,
  certificate,
}) => {
  const httpServer = http.createServer()
  const tlsServer = await createSecureServer({
    privateKey,
    certificate,
    http2,
    http1Allowed,
  })
  const netServer = net.createServer({
    allowHalfOpen: false,
  })

  listenEvent(netServer, "connection", (socket) => {
    detectSocketProtocol(socket, (protocol) => {
      if (protocol === "http") {
        httpServer.emit("connection", socket)
        return
      }

      if (protocol === "tls") {
        tlsServer.emit("connection", socket)
        return
      }

      const response = [`HTTP/1.1 400 Bad Request`, `Content-Length: 0`, "", ""].join("\r\n")
      socket.write(response)
      socket.end()
      socket.destroy()
      netServer.emit("clientError", new Error("protocol error, Neither http, nor tls"), socket)
    })
  })

  netServer._httpServer = httpServer
  netServer._tlsServer = tlsServer

  return netServer
}

// The async part is just to lazyly import "http2" or "https"
// so that these module are parsed only if used.
const createSecureServer = async ({ privateKey, certificate, http2, http1Allowed }) => {
  if (http2) {
    const { createSecureServer } = await import("http2")
    return createSecureServer({
      key: privateKey,
      cert: certificate,
      allowHTTP1: http1Allowed,
    })
  }

  const { createServer } = await import("https")
  return createServer({
    key: privateKey,
    cert: certificate,
  })
}

const detectSocketProtocol = (socket, protocolDetectedCallback) => {
  let removeOnceReadableListener = () => {}

  const tryToRead = () => {
    const buffer = socket.read(1)
    if (buffer === null) {
      removeOnceReadableListener = socket.once("readable", tryToRead)
      return
    }

    const firstByte = buffer[0]
    socket.unshift(buffer)
    if (firstByte === 22) {
      protocolDetectedCallback("tls")
      return
    }
    if (firstByte > 32 && firstByte < 127) {
      protocolDetectedCallback("http")
      return
    }
    protocolDetectedCallback(null)
  }

  tryToRead()

  return () => {
    removeOnceReadableListener()
  }
}
