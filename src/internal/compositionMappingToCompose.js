export const compositionMappingToCompose = (compositionMapping, createInitial = () => ({})) => {
  const reducer = compositionMappingToReducer(compositionMapping)
  return (...objects) => objects.reduce(reducer, createInitial())
}

const compositionMappingToReducer = (compositionMapping) => {
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

    const composed = { ...previous }
    Object.keys(current).forEach((key) => {
      composed[key] = composeProperty(key, previous, current)
    })
    return composed
  }
}
