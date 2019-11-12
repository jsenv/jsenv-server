import { firstOperationMatching } from "@jsenv/cancellation"

export const firstService = (...callbacks) => {
  return firstOperationMatching({
    array: callbacks,
    start: (callback) => callback(),
    predicate: serviceGeneratedResponsePredicate,
  })
}

const serviceGeneratedResponsePredicate = (value) => {
  if (value === null) {
    return false
  }
  return typeof value === "object"
}
