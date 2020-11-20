import { resolveUrl, writeFile, ensureEmptyDirectory } from "@jsenv/util"
import { startServer, fetchUrl } from "@jsenv/server"

const htmlFilesDirectoryUrl = resolveUrl("./html-files/", import.meta.url)

const generateInternalErrorHtmlFile = async (htmlFilename, serverParams) => {
  const { origin, stop } = await startServer({
    logLevel: "off",
    protocol: "http",
    keepProcessAlive: false,
    ...serverParams,
  })
  {
    const response = await fetchUrl(origin, {
      simplified: true,
      headers: {
        accept: "text/html",
      },
    })
    stop()
    const htmlFileUrl = resolveUrl(htmlFilename, htmlFilesDirectoryUrl)
    await writeFile(htmlFileUrl, response.body)
  }
}

await ensureEmptyDirectory(htmlFilesDirectoryUrl)

await generateInternalErrorHtmlFile("basic.html", {
  requestToResponse: () => {
    const error = new Error("test")
    throw error
  },
})

await generateInternalErrorHtmlFile("basic-with-details.html", {
  requestToResponse: () => {
    const error = new Error("test")
    throw error
  },
  sendServerInternalErrorDetails: true,
})

await generateInternalErrorHtmlFile("basic-with-code-and-details.html", {
  requestToResponse: () => {
    const error = new Error("test")
    error.code = "TEST_CODE"
    throw error
  },
  sendServerInternalErrorDetails: true,
})

await generateInternalErrorHtmlFile("literal.html", {
  requestToResponse: () => {
    const error = "a string"
    throw error
  },
})

await generateInternalErrorHtmlFile("literal-with-details.html", {
  requestToResponse: () => {
    const error = "a string"
    throw error
  },
  sendServerInternalErrorDetails: true,
})
