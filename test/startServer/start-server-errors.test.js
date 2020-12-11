import { assert } from "@jsenv/assert"
import { startServer } from "@jsenv/server"

try {
  await startServer({
    forcePort: true,
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("no need to pass forcePort when port is 0")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "toto",
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("protocol must be http or https, got toto")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "https",
    privateKey: null,
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("missing privateKey for https server")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "https",
    certificate: null,
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("missing certificate for https server")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "https",
    privateKey: "toto",
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("you passed a privateKey without certificate")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "https",
    certificate: "toto",
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error("you passed a certificate without privateKey")
  assert({ actual, expected })
}

try {
  await startServer({
    protocol: "http",
    http2: true,
  })
  throw new Error("should throw")
} catch (actual) {
  const expected = new Error(`http2 needs "https" but protocol is "http"`)
  assert({ actual, expected })
}
