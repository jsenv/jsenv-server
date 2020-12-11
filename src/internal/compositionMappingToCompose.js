export const compositionMappingToCompose = (
  compositionMapping,
  createInitial = () => {
    return {}
  },
  { lowercase = false } = {},
) => {
  const reducer = compositionMappingToReducer(compositionMapping, { lowercase })
  return (...objects) => objects.reduce(reducer, createInitial())
}

const compositionMappingToReducer = (compositionMapping, { lowercase }) => {
  const composeProperty = (key, previous, current) => {
    const propertyExistInCurrent = key in current
    if (!propertyExistInCurrent) return previous[key]

    const propertyExistInPrevious = key in previous
    if (!propertyExistInPrevious) return current[key]

    const propertyHasComposer = key in compositionMapping
    if (!propertyHasComposer) return current[key]

    const composerForProperty = compositionMapping[key]
    return composerForProperty(previous[key], current[key])
  }

  return (previous, current) => {
    if (typeof current !== "object" || current === null) return previous

    const composed = {}
    Object.keys(previous).forEach((key) => {
      if (lowercase) key = key.toLowerCase()
      composed[key] = previous[key]
    })
    Object.keys(current).forEach((key) => {
      if (lowercase) key = key.toLowerCase()
      composed[key] = composeProperty(key, previous, current)
    })
    return composed
  }
}
