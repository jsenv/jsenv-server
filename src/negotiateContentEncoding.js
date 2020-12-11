import { applyContentNegotiation } from "./internal/applyContentNegotiation.js"
import { parseMultipleHeader } from "./internal/multiple-header.js"

export const negotiateContentEncoding = (request, availableEncodings) => {
  const { headers = {} } = request
  const requestAcceptEncodingHeader = headers["accept-encoding"]
  if (!requestAcceptEncodingHeader) {
    return null
  }

  const encodingsAccepted = parseAcceptEncodingHeader(requestAcceptEncodingHeader)
  return applyContentNegotiation({
    accepteds: encodingsAccepted,
    availables: availableEncodings,
    acceptablePredicate: (accepted, availableEncoding) => {
      return acceptableEncodingPredicate(availableEncoding, accepted.encoding)
    },
  })
}

const parseAcceptEncodingHeader = (acceptEncodingHeaderString) => {
  const acceptEncodingHeader = parseMultipleHeader(acceptEncodingHeaderString, {
    validateProperty: ({ name }) => {
      // read only q, anything else is ignored
      return name === "q"
    },
  })

  const encodingsAccepted = []
  Object.keys(acceptEncodingHeader).forEach((key) => {
    const { q = 1 } = acceptEncodingHeader[key]
    const encoding = key
    encodingsAccepted.push({
      encoding,
      quality: q,
    })
  })
  encodingsAccepted.sort((a, b) => {
    return b.quality - a.quality
  })
  return encodingsAccepted
}

const acceptableEncodingPredicate = (encoding, pattern) => {
  if (pattern === "*") {
    return true
  }

  // normalize br to brotli
  if (pattern === "br") pattern = "brotli"
  if (encoding === "br") encoding = "brotli"

  if (pattern === encoding) {
    return true
  }
  return false
}
