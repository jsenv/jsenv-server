import { startServer, serveFile } from "@jsenv/server"

const publicDirectoryUrl = new URL("./public", import.meta.url)

startServer({
  requestToResponse: (request) => {
    return serveFile(request, {
      rootDirectoryUrl: publicDirectoryUrl,
      canReadDirectory: true,
      etagEnabled: true,
      compressionEnabled: true,
      compressionSizeThreshold: 1,
    })
  },
})
