import { assert } from "@dmail/assert"
import { acceptsContentType } from "../../index.js"

{
  const actual = acceptsContentType("text/html", "text/html")
  const expected = true
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/html", "text/plain")
  const expected = false
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/*", "text/plain")
  const expected = true
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("image/*", "text/plain")
  const expected = false
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("*/*", "text/plain")
  const expected = true
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/plain, application/javascript", "application/javascript")
  const expected = true
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/plain, application/javascript", "application/pdf")
  const expected = false
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/plain, */*", "application/javascript")
  const expected = true
  assert({ actual, expected })
}

{
  const actual = acceptsContentType("text/plain, */*;q=0.1", "application/javascript")
  const expected = true
  assert({ actual, expected })
}
