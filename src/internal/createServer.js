export const createServer = async ({ http2, http1Allowed, protocol, privateKey, certificate }) => {
  if (protocol === "http") {
    if (http2) {
      const { createServer } = await import("http2")
      return createServer()
    }

    const { createServer } = await import("http")
    return createServer()
  }

  if (protocol === "https") {
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

  throw new Error(`unsupported protocol ${protocol}`)
}