import { negotiateContentType } from "./negotiateContentType.js"

export const jsenvServerInternalErrorToResponse = (
  serverInternalError,
  { request, sendServerInternalErrorDetails = false },
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
        ...(sendServerInternalErrorDetails
          ? {
              stack: serverInternalError.stack,
              ...serverInternalError,
            }
          : {}),
      }

  const availableContentTypes = {
    "text/html": () => {
      const renderHtmlForErrorWithoutDetails = () => {
        return `<p>Details not available: to enable them server must be started with sendServerInternalErrorDetails: true.</p>`
      }

      const renderHtmlForErrorWithDetails = () => {
        if (serverInternalErrorIsAPrimitive) {
          return `<pre>${JSON.stringify(serverInternalError, null, "  ")}</pre>`
        }
        return `<pre>${serverInternalError.stack}</pre>`
      }

      const body = `<!DOCTYPE html>
<html>
  <head>
    <title>Internal server error</title>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
  </head>

  <body>
    <h1>Internal server error</h1>
    <p>${
      serverInternalErrorIsAPrimitive
        ? `Code inside server has thrown a literal.`
        : `Code inside server has thrown an error.`
    }</p>
    <details>
      <summary>See internal error details</summary>
      ${
        sendServerInternalErrorDetails
          ? renderHtmlForErrorWithDetails()
          : renderHtmlForErrorWithoutDetails()
      }
    </details>
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
