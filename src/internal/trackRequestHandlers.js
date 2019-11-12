export const trackRequestHandlers = (nodeServer) => {
  const requestHandlers = []
  const add = (handler) => {
    requestHandlers.push(handler)
    nodeServer.on("request", handler)
    return () => {
      nodeServer.removeListener("request", handler)
    }
  }

  const stop = () => {
    requestHandlers.forEach((requestHandler) => {
      nodeServer.removeListener("request", requestHandler)
    })
    requestHandlers.length = 0
  }

  return { add, stop }
}
