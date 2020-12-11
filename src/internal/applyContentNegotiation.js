export const applyContentNegotiation = ({ availables, accepteds, acceptablePredicate }) => {
  let highestQuality = -1
  let availableWithHighestQuality = null

  let availableIndex = 0
  while (availableIndex < availables.length) {
    const available = availables[availableIndex]
    availableIndex++

    let acceptedIndex = 0
    while (acceptedIndex < accepteds.length) {
      const accepted = accepteds[acceptedIndex]
      acceptedIndex++

      const acceptable = acceptablePredicate(accepted, available)
      if (acceptable) {
        const quality = accepted.quality
        if (quality > highestQuality) {
          availableWithHighestQuality = available
          highestQuality = quality
        }
      }
    }
  }

  return availableWithHighestQuality
}
