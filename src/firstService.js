import { firstOperationMatching } from "@jsenv/cancellation"
import { measureFunctionDuration } from "./internal/measureFunctionDuration.js"
import { composeResponse } from "./composeResponse.js"

export const firstService = (...callbacks) => {
  return (request) => {
    return firstOperationMatching({
      array: callbacks,
      start: (callback) => callback(request),
      predicate: serviceGeneratedResponsePredicate,
    })
  }
}

export const firstServiceWithTiming = (namedServices) => {
  return async (request) => {
    const servicesTiming = {}
    const response = await firstOperationMatching({
      array: Object.keys(namedServices).map((serviceName) => {
        return { serviceName, serviceFn: namedServices[serviceName] }
      }),
      start: async ({ serviceName, serviceFn }) => {
        const [time, value] = await measureFunctionDuration(() => serviceFn(request))
        servicesTiming[`service${serviceName}`] = time
        return value
      },
      predicate: (value) => {
        if (value === null) {
          return false
        }
        return typeof value === "object"
      },
    })
    if (response) {
      return composeResponse({ timing: servicesTiming }, response)
    }
    return null
  }
}

const serviceGeneratedResponsePredicate = (value) => {
  if (value === null) {
    return false
  }
  return typeof value === "object"
}
