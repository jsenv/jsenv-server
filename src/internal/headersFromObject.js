/*
https://developer.mozilla.org/en-US/docs/Web/API/Headers
https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
*/

import { normalizeHeaderName } from "./normalizeHeaderName.js"
import { normalizeHeaderValue } from "./normalizeHeaderValue.js"

export const headersFromObject = (headersObject) => {
  const headers = {}

  Object.keys(headersObject).forEach((headerName) => {
    headers[normalizeHeaderName(headerName)] = normalizeHeaderValue(headersObject[headerName])
  })

  return headers
}
