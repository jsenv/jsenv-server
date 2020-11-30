# server

High level api for node.js server.

[![github package](https://img.shields.io/github/package-json/v/jsenv/jsenv-server.svg?logo=github&label=package)](https://github.com/jsenv/jsenv-server/packages)
[![npm package](https://img.shields.io/npm/v/@jsenv/server.svg?logo=npm&label=package)](https://www.npmjs.com/package/@jsenv/server)
[![github ci](https://github.com/jsenv/jsenv-server/workflows/ci/badge.svg)](https://github.com/jsenv/jsenv-server/actions?workflow=ci)
[![codecov coverage](https://codecov.io/gh/jsenv/jsenv-server/branch/master/graph/badge.svg)](https://codecov.io/gh/jsenv/jsenv-server)

# Table of contents

- [Presentation](#Presentation)
- [Installation](#Installation)
- [Documentation](#Documentation)
  - [startServer](./docs/start-server.md)
  - [firstService](./docs/first-service.md)
  - [serveFile](./docs/serve-file.md)
  - [fetchUrl](./docs/fetch-url.md)

# Presentation

`@jsenv/server` helps to start server with a simplified api to focus on writing your application code. The api make your code easier to compose and test in isolation.

The following code starts a server listening to `http://127.0.0.1:8080` responding `Hello world` as plain text.

```js
import { startServer } from "@jsenv/server"

startServer({
  protocol: "http",
  ip: "127.0.0.1",
  port: 8080,
  requestToResponse: () => {
    return {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
      body: "Hello world",
    }
  },
})
```

`@jsenv/server` can also be required if you need to.

```js
const { startServer } = require("@jsenv/server")
```

# Installation

```console
npm install @jsenv/server
```

# Documentation

Api can be found in their own pages

- [startServer](./docs/start-server.md)
- [firstService](./docs/first-service.md)
- [serveFile](./docs/serve-file.md)
- [fetchUrl](./docs/fetch-url.md)
