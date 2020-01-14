# Table of contents

- [serveFile example](#serveFile-example)
- [serveFile and requestToResponse](#serveFile-and-requestToResponse)
- [serveFile parameters](#serveFile-parameters)
  - [path](#path)
  - [method](#method)
  - [headers](#headers)
  - [cacheStrategy](#cacheStrategy)
  - [contentTypeMap](#contentTypeMap)
  - [canReadDirectory](#canReadDirectory)

# serveFile example

`serveFile` is an async function that will search for a file on your filesysten and produce a response for it

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

— source code at [src/serveFile.js](../src/serveFile.js).

# serveFile and requestToResponse

`serveFile` produces a response that can be used directory inside `requestToResponse`

```js
import { serveFile, startServer } from "@jsenv/server"

startServer({
  requestToResponse: async ({ ressource, methods, headers }) => {
    const response = await serveFile(`${__dirname}${ressource}`, {
      method,
      headers,
    })
    return response
  },
})
```

# serveFile parameters

## source

`source` parameter is a string leading to a filesystem node (file or directory).

## method

`method` parameter is a string representing an http request method. This parameter is optional with a default value of `"GET"`.

When method is not `"HEAD"` or `"GET"` the returned response correspond to `501 not implemented`.

## headers

`headers` parameter is an object representing http request headers. This parameter is optional with a default value of `{}`.

Two header might be checked in this optionnal object: `if-modified-since` and `if-none-match`. They will be checked according to `cacheStrategy` below.

## cacheStrategy

`cacheStrategy` parameter is a string controlling if server check `headers` parameter and add headers for cache in response. This parameter is optional with a default value of `"etag"`.

When `"mtime"`: response will contain `"last-modified"` header<br />
When `"etag"`: response will contain `"etag"` header<br />
When `"none"`: response will contain `"cache-control": "no-store"` header<br />

## contentTypeMap

`contentTypeMap` parameteris is an object used to get content type from an url. This parameter is optional with a default value coming from [src/jsenvContentTypeMap.js](../src/jsenvContentTypeMap.js).

You can extend `contentTypeMap` to add or replace contentTypes mapping like this:

```js
import { serveFile, jsenvContentTypeMap } from "@jsenv/server"

const response = await serveFile("/Users/you/folder/index.html", {
  method: "GET",
  contentTypeMap: {
    ...jsenvContentTypeMap,
    "application/x-whatever": {
      extensions: ["whatever", "whatever-2"],
    },
  },
})
```

## canReadDirectory

`canReadDirectory` parameter is a boolean indicating if reading a directory is allowed. This parameter is optional with a default value of `false`.

When false `serveFile` respond with `403 not allowed to read directory` when `path` leads to a directory on your filesystem.

When true `serveFile` respond with `200` and response is a json string being an array of filenames inside the directory.
