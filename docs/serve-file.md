# Table of contents

- [serveFile example](#serveFile-example)
- [serveFile parameters](#serveFile-parameters)
  - [path](#path)
  - [method](#method)
  - [headers](#headers)
  - [cacheStrategy](#cacheStrategy)
  - [contentTypeMap](#contentTypeMap)
  - [canReadDirectory](#canReadDirectory)

# serveFile example

> `serveFile` is an async function that will search for a file on your filesysten and produce a response for it

Implemented in [src/file-service/serve-file.js](../src/file-service/serve-file.js), you can use it as shown below.

```js
import { serveFile } from "@jsenv/server"

const response = await serveFile("/Users/you/folder/index.html", {
  method: "GET",
  headers: {
    "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT",
  },
  cacheStrategy: "mtime",
})
```

`serveFile` was designe to produce a response and called inside `requestToResponse` like this:

```js
import { serveFile, startServer } from "@jsenv/server"

startServer({
  requestToResponse: ({ ressource, methods, headers }) =>
    serveFile(`${__dirname}${ressource}`, {
      method,
      headers,
    }),
})
```

# serveFile parameters

## path

> `path` is the first parameter of serveFile, it is a string leading to a filesystem entry.

## method

> `method` is a string representing an http request method.

This parameter is optional with a default value of

```js
"GET"
```

When method is not `HEAD` or `GET` the returned response correspond to `501 not implemented`.

## headers

> `headers` is an object representing http request headers.

This parameter is optional with a default value of

<!-- prettier-ignore -->
```js
{}
```

Two header might be checked in this optionnal object: `if-modified-since` and `if-none-match`. They will be checked according to `cacheStrategy` below.

## cacheStrategy

> `cacheStrategy` is a string controlling if server check `headers` parameter and add headers for cache in response.

This parameter is optional with a default value of

```js
"etag"
```

When `"mtime"`: response will contain `"last-modified"` header<br />
When `"etag"`: response will contain `"etag"` header<br />
When `"none"`: response will contain `"cache-control": "no-store"` header<br />

## contentTypeMap

> `contentTypeMap` is an object used to get content type from an url.

This parameter is optional with a default value coming from [file-service/content-type-map.js](../src/file-service/content-type-map.js).

You can extend `contentTypeMap` to add or replace contentTypes mapping like this:

```js
import { serveFile } from "@jsenv/server"

const response = await serveFile("/Users/you/folder/index.html", {
  method: "GET",
  contentTypeMap: {
    ...defaultContentTypeMap,
    "application/x-whatever": {
      extensions: ["whatever", "whatever-2"],
    },
  },
})
```

### canReadDirectory

> `canReadDirectory` is a boolean indicating if reading a directory is allowed.

This parameter is optional with a default value of

```js
false
```

When false `serveFile` respond with `403 not allowed to read directory` when `path` leads to a directory on your filesystem.

When true `serveFile` respond with `200` and response is a json string being an array of filenames inside the directory.
