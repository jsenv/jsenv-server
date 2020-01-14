import { assert } from "@jsenv/assert"
import { composeResponse } from "../../index.js"

{
  const actual = composeResponse(
    {
      headers: { foo: true },
    },
    {
      headers: { foo: false },
    },
  )
  const expected = {
    status: undefined,
    statusText: undefined,
    headers: {
      foo: false,
    },
    body: undefined,
    bodyEncoding: undefined,
  }
  assert({ actual, expected })
}

{
  const actual = composeResponse(
    {
      headers: {
        "access-control-allow-headers": "a, b",
      },
    },
    {
      headers: {
        "access-control-allow-headers": "c, a",
        "content-type": "application/javascript",
      },
    },
  )
  const expected = {
    status: undefined,
    statusText: undefined,
    headers: {
      "access-control-allow-headers": "a, b, c",
      "content-type": "application/javascript",
    },
    body: undefined,
    bodyEncoding: undefined,
  }
  assert({ actual, expected })
}
