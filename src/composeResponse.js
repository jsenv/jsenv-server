import { compositionMappingToComposeStrict } from "./internal/compositionMappingToComposeStrict.js"
import { composeResponseHeaders } from "./internal/composeResponseHeaders.js"

const responseCompositionMapping = {
  status: (prevStatus, status) => status,
  statusText: (prevStatusText, statusText) => statusText,
  headers: composeResponseHeaders,
  body: (prevBody, body) => body,
  bodyEncoding: (prevEncoding, encoding) => encoding,
  timing: (prevTiming, timing) => {
    return { ...prevTiming, ...timing }
  },
}

export const composeResponse = compositionMappingToComposeStrict(responseCompositionMapping)
