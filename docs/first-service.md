# Table of contents

- [firstService specifications](#firstService-specifications)
- [firstService example](#firstService-example)

# firstService specifications

`firstService` helps you to create complex `requestToResponse` parameter used by `startServer`.<br />
— see [startServer#requestToResponse](./start-server.md#requestToResponse)

It works like this:

1. It accepts 0 or more function
2. Set `serviceCandidate` to the first function
3. Calls `serviceCandidate` and **awaits** its `return value`.
4. If `return value` is a non null object it is returned.<br />
   Otherwise, set `serviceCandidate` to the next function and go to step 3

# firstService example

> `firstService` is a function returning the first response produced by other functions.

Implemented in [src/firstService.js](../src/firstService.js), you can use it as shown below.

```js
import { firstService } from "@jsenv/server"

const requestToResponse = (request) => {
  return firstService(
    () => {
      if (ressource !== "/") return null
      return { status: 204 }
    },
    () => {
      if (ressource !== "/whatever") return null
      return { status: 200 }
    },
  )
}
```

`requestToResponse` above have the following behaviour:

- returns `204 no content` response for `/`
- returns `200 ok` response for `/whatever`
