import { applyContentNegotiation } from "./internal/applyContentNegotiation.js"
import { parseMultipleHeader } from "./internal/multiple-header.js"

export const negotiateContentType = (request, availableContentTypes) => {
  const { headers = {} } = request
  const requestAcceptHeader = headers.accept
  if (!requestAcceptHeader) {
    return null
  }

  const contentTypesAccepted = parseAcceptHeader(requestAcceptHeader)
  return applyContentNegotiation({
    accepteds: contentTypesAccepted,
    availables: availableContentTypes,
    acceptablePredicate: (accepted, availableContentType) => {
      return acceptableContentTypePredicate(availableContentType, accepted.type)
    },
  })
}

const parseAcceptHeader = (acceptHeader) => {
  const acceptHeaderObject = parseMultipleHeader(acceptHeader, {
    validateProperty: ({ name }) => {
      // read only q, anything else is ignored
      return name === "q"
    },
  })

  const accepts = []
  Object.keys(acceptHeaderObject).forEach((key) => {
    const { q = 1 } = acceptHeaderObject[key]
    const type = key
    accepts.push({
      type,
      quality: q,
    })
  })
  accepts.sort((a, b) => {
    return b.quality - a.quality
  })
  return accepts
}

const acceptableContentTypePredicate = (type, pattern) => {
  const typeComposition = decomposeType(type)
  const patternComposition = decomposeType(pattern)

  if (patternComposition.type === "*") {
    if (patternComposition.subtype === "*") {
      return true
    }
    return patternComposition.subtype === typeComposition.subtype
  }

  if (patternComposition.type === typeComposition.type) {
    if (patternComposition.subtype === "*") {
      return true
    }
    return patternComposition.subtype === typeComposition.subtype
  }

  return false
}

const decomposeType = (fullType) => {
  const parts = fullType.split("/")
  const type = parts[0]
  const subtype = parts[1]
  return { type, subtype }
}
