/**

https://stackoverflow.com/a/42019773/2634179

*/

import http from "http"
import httpsModule from "https"
import http2Module from "http2"
import net from "net"

export const createServer = ({
  http2 = false,
  http1Allowed = true,
  // protocol,
  privateKey,
  certificate,
  requestHandler = () => {},
}) => {
  const httpServer = http.createServer()

  const secureServer = http2
    ? http2Module.createSecureServer({
        key: privateKey,
        cert: certificate,
        allowHTTP1: http1Allowed,
      })
    : httpsModule.createServer({
        key: privateKey,
        cert: certificate,
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
        secureServer.emit("connection", socket)
        return
      }

      const response = [`HTTP/1.1 400 Bad Request`, `Content-Length: 0`, "", ""].join("\r\n")
      socket.write(response)
      socket.end()
      socket.destroy()
      netServer.emit("clientError", new Error("protocol error, Neither http, nor tls"), socket)
    })
  })

  listenEvent(httpServer, "request", requestHandler)
  listenEvent(secureServer, "request", (nodeRequest, nodeResponse) => {
    nodeRequest.on("error", (error) => {
      console.log("request error", error)
    })
    requestHandler(nodeRequest, nodeResponse)
  })

  httpServer.on("clientError", (error, socket) => {
    netServer.emit("clientError", error, socket)
  })
  secureServer.on("clientError", (error, socket) => {
    netServer.emit("clientError", error, socket)
  })

  return netServer
}

export const listenServerConnectionError = (
  nodeServer,
  connectionErrorCallback,
  { ignoreErrorAfterConnectionIsDestroyed = true } = {},
) => {
  const cleanupSet = new Set()

  const removeConnectionListener = listenEvent(nodeServer, "connection", (socket) => {
    const removeSocketErrorListener = listenEvent(socket, "error", (error) => {
      if (ignoreErrorAfterConnectionIsDestroyed && socket.destroyed) {
        return
      }
      connectionErrorCallback(error, socket)
    })
    const removeOnceSocketCloseListener = listenEvent(
      socket,
      "close",
      () => {
        removeSocketErrorListener()
        cleanupSet.delete(cleanup)
      },
      {
        once: true,
      },
    )
    const cleanup = () => {
      removeSocketErrorListener()
      removeOnceSocketCloseListener()
    }
    cleanupSet.add(cleanup)
  })
  return () => {
    removeConnectionListener()
    cleanupSet.forEach((cleanup) => {
      cleanup()
    })
  }
}

export const listenClientError = (nodeServer, clientErrorCallback) => {
  return listenEvent(nodeServer, "clientError", clientErrorCallback)
}

const listenEvent = (objectWithEventEmitter, eventName, callback, { once = false } = {}) => {
  if (once) {
    objectWithEventEmitter.once(eventName, callback)
  } else {
    objectWithEventEmitter.addListener(eventName, callback)
  }
  return () => {
    objectWithEventEmitter.removeListener(eventName, callback)
  }
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
