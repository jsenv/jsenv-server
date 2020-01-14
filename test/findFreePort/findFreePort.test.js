import { assert } from "@jsenv/assert"
import { findFreePort } from "../../index.js"

const port = await findFreePort()
const actual = typeof port
const expected = "number"
assert({ actual, expected })
