import { compositionMappingToCompose } from "./compositionMappingToCompose.js"

const composeHeaderValues = (value, nextValue) => {
  const headerValues = value.split(", ")
  nextValue.split(", ").forEach((value) => {
    if (!headerValues.includes(value)) {
      headerValues.push(value)
    }
  })
  return headerValues.join(", ")
}

const headerCompositionMapping = {
  "accept": composeHeaderValues,
  "accept-charset": composeHeaderValues,
  "accept-language": composeHeaderValues,
  "access-control-allow-headers": composeHeaderValues,
  "access-control-allow-methods": composeHeaderValues,
  "access-control-allow-origin": composeHeaderValues,
  // https://www.w3.org/TR/server-timing/
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing
  "server-timing": composeHeaderValues,
  // 'content-type', // https://github.com/ninenines/cowboy/issues/1230
  "vary": composeHeaderValues,
}

export const composeResponseHeaders = compositionMappingToCompose(
  headerCompositionMapping,
  () => ({}),
  { lowercase: true },
)
