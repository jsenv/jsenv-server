import { negotiateContentType } from "./negotiateContentType.js"

export const jsenvServerInternalErrorToResponse = (
  serverInternalError,
  { request, sendServerInternalErrorStack = false },
) => {
  const serverInternalErrorIsAPrimitive =
    serverInternalError === null ||
    (typeof serverInternalError !== "object" && typeof serverInternalError !== "function")

  const dataToSend = serverInternalErrorIsAPrimitive
    ? {
        code: "VALUE_THROWED",
        value: serverInternalError,
      }
    : {
        code: serverInternalError.code || "UNKNOWN_ERROR",
        ...(sendServerInternalErrorStack ? { stack: serverInternalError.stack } : {}),
      }

  const availableContentTypes = {
    "text/html": () => {
      const body = `<!DOCTYPE html>
<html>
  <head>
    <title>Internal server error</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>An internal server error occured (${dataToSend.code})</h1>
    <pre>${dataToSend.stack}</pre>
  </body>
</html>`

      return {
        headers: {
          "content-type": "text/html",
          "content-length": Buffer.byteLength(body),
        },
        body,
      }
    },
    "application/json": () => {
      const body = JSON.stringify(dataToSend)
      return {
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        body,
      }
    },
  }
  const bestContentType = negotiateContentType(request, Object.keys(availableContentTypes))
  return availableContentTypes[bestContentType || "application/json"]()
}
