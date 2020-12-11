import { parseAcceptHeader } from "./internal/header-accept.js"

export const negotiateContentType = (request, availableContentTypes) => {
  const { headers = {} } = request
  const requestAcceptHeader = headers.accept
  if (!requestAcceptHeader) {
    return null
  }

  const contentTypesAccepted = parseAcceptHeader(requestAcceptHeader)

  const availableContentTypesAcceptResults = availableContentTypes.map((availableContentType) => {
    return acceptsContentType({
      contentTypesAccepted,
      contentType: availableContentType,
    })
  })
  const bestAcceptResult = getBestAcceptResult(availableContentTypesAcceptResults)

  if (bestAcceptResult.accepted) {
    const index = availableContentTypesAcceptResults.indexOf(bestAcceptResult)
    const bestAcceptedAvailableContentType = availableContentTypes[index]
    return bestAcceptedAvailableContentType
  }

  return null
}

const acceptsContentType = ({ contentTypesAccepted, contentType }) => {
  const acceptResults = contentTypesAccepted.map((contentTypeAccepted) => {
    const accepted = typeMatches(contentType, contentTypeAccepted.type)
    return {
      accepted,
      score: contentTypeAccepted.quality,
    }
  })

  return getBestAcceptResult(acceptResults)
}

const typeMatches = (type, pattern) => {
  const typeComposition = decomposeType(type)
  const patternComposition = decomposeType(pattern)

  if (patternComposition.type === "*") {
    if (patternComposition.subtype === "*") return true
    return patternComposition.subtype === typeComposition.subtype
  }
  if (patternComposition.type === typeComposition.type) {
    if (patternComposition.subtype === "*") return true
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

const getBestAcceptResult = (acceptResults) => {
  const bestAcceptsResult = acceptResults.reduce(
    (previous, acceptResult) => {
      if (!acceptResult.accepted) {
        return previous
      }
      if (previous.score >= acceptResult.score) {
        return previous
      }
      return acceptResult
    },
    {
      accepted: false,
      score: -1,
    },
  )
  return bestAcceptsResult
}
