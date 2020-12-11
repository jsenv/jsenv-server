/* eslint-disable no-nested-ternary */
export const compositionMappingToCompose = (
  compositionMapping,
  createInitial = () => {
    return {}
  },
  { caseSensitive = true } = {},
) => {
  const reducer = compositionMappingToReducer(compositionMapping, { caseSensitive })
  return (...objects) => objects.reduce(reducer, createInitial())
}

const compositionMappingToReducer = (compositionMapping, { caseSensitive }) => {
  return (previous, current) => {
    if (typeof current !== "object" || current === null) {
      return previous
    }

    const composed = {}
    Object.keys(previous).forEach((key) => {
      const composedKey = caseSensitive ? key : key.toLowerCase()
      composed[composedKey] = previous[key]
    })
    Object.keys(current).forEach((key) => {
      const composedKey = caseSensitive ? key : key.toLowerCase()
      composed[composedKey] = caseSensitive
        ? composeProperty(key, previous, current, compositionMapping)
        : composePropertyCaseInsensitive(key, previous, current, compositionMapping)
    })
    return composed
  }
}

const composeProperty = (key, previous, current, compositionMapping) => {
  const keyExistingInCurrent = keyExistsIn(key, current) ? key : null
  if (!keyExistingInCurrent) {
    return previous[key]
  }

  const keyExistingInPrevious = keyExistsIn(key, previous) ? key : null
  if (!keyExistingInPrevious) {
    return current[key]
  }

  const keyExistingInComposer = keyExistsIn(key, compositionMapping) ? key : null
  if (!keyExistingInComposer) {
    return current[key]
  }

  const composerForProperty = compositionMapping[keyExistingInComposer]
  return composerForProperty(previous[keyExistingInPrevious], current[keyExistingInCurrent])
}

const composePropertyCaseInsensitive = (key, previous, current, compositionMapping) => {
  const keyLowercased = key.toLowerCase()
  const keyExistingInCurrent = keyExistsIn(key, current)
    ? key
    : keyExistsIn(keyLowercased, current)
    ? keyLowercased
    : null
  const keyExistingInPrevious = keyExistsIn(key, previous)
    ? key
    : keyExistsIn(keyLowercased, previous)
    ? keyLowercased
    : null

  if (!keyExistingInCurrent) {
    return previous[keyExistingInPrevious]
  }

  if (!keyExistingInPrevious) {
    return current[keyExistingInCurrent]
  }

  const keyExistingInComposer = keyExistsIn(keyLowercased, compositionMapping)
    ? keyLowercased
    : null
  if (!keyExistingInComposer) {
    return current[keyExistingInCurrent]
  }

  const composerForProperty = compositionMapping[keyExistingInComposer]
  return composerForProperty(previous[keyExistingInPrevious], current[keyExistingInCurrent])
}

const keyExistsIn = (key, object) => {
  return Object.prototype.hasOwnProperty.call(object, key)
}
