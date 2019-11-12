export const acceptsContentType = (acceptHeader, contentType) => {
  if (typeof acceptHeader !== "string") {
    return false
  }

  return acceptHeader.split(",").some((acceptRaw) => {
    const accept = parseAccept(acceptRaw)
    return typeMatches(contentType, accept.type)
  })
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
