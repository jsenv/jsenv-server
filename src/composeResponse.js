import { composeResponseHeaders } from "./composeResponseHeaders.js"

const responseCompositionMapping = {
  status: (prevStatus, status) => status,
  statusText: (prevStatusText, statusText) => statusText,
  headers: composeResponseHeaders,
  body: (prevBody, body) => body,
  bodyEncoding: (prevEncoding, encoding) => encoding,
}

export const composeResponse = compositionMappingToComposeStrict(responseCompositionMapping)
