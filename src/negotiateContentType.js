export const negotiateContentType = (request, availableContentTypes) => {
  const availableContentTypesAcceptResults = availableContentTypes.map((availableContentType) => {
    return acceptsContentType({
      acceptHeader: request.headers.accept,
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

const acceptsContentType = ({ acceptHeader, contentType }) => {
  if (typeof acceptHeader !== "string") {
    return {
      accepted: false,
      score: -1,
    }
  }

  const acceptResults = acceptHeader.split(",").map((acceptRaw) => {
    const accept = parseAccept(acceptRaw)
    const accepted = typeMatches(contentType, accept.type)
    return {
      accepted,
      score: accept.score,
    }
  })

  return getBestAcceptResult(acceptResults)
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

const parseAccept = (accept) => {
  const acceptTrimmed = accept.trim()
  const scoreIndex = acceptTrimmed.indexOf(";q=")

  let type
  let score
  if (scoreIndex > -1) {
    const beforeScore = acceptTrimmed.slice(0, scoreIndex)
    const afterScore = acceptTrimmed.slice(scoreIndex + ";q=".length)
    type = beforeScore
    score = parseFloat(afterScore)
  } else {
    type = acceptTrimmed
    score = 1
  }

  return {
    type,
    score,
  }
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
