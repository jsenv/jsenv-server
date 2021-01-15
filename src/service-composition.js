import { firstOperationMatching } from "@jsenv/cancellation"
import { timeFunction } from "./serverTiming.js"
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
        const [serviceTiming, value] = await timeFunction(serviceName, () => serviceFn(request))
        Object.assign(servicesTiming, serviceTiming)
        return value
      },
      predicate: serviceGeneratedResponsePredicate,
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
