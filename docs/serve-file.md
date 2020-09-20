# Table of contents

- [serveFile example](#serveFile-example)
- [serveFile and requestToResponse](#serveFile-and-requestToResponse)
- [serveFile parameters](#serveFile-parameters)
  - [source](#source)
  - [method](#method)
  - [headers](#headers)
  - [contentTypeMap](#contentTypeMap)
  - [cacheControl](#cacheControl)
  - [etagEnabled](#etagEnabled)
  - [mtimeEnabled](#mtimeEnabled)
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

Two header might be checked in this optionnal object: `if-modified-since` and `if-none-match`. They will be checked according to `etagEnabled` and `mtimeEnabled` parameters.

## contentTypeMap

`contentTypeMap` parameter is an object used to get content type from an url. This parameter is optional with a default value coming from [src/jsenvContentTypeMap.js](../src/jsenvContentTypeMap.js).

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

## cacheControl

`cacheControl` parameter is a string that will become the response `cache-control` header value. This parameter is optional with a default value of `"no-store"`. When `etagEnabled` or `mtimeEnabled` is true, this parameter default value is `"private"`

Check https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control for more information about this header.

## etagEnabled

`etagEnabled` parameter is a boolean enabling `etag` headers. When enabled server sends `etag` response header and check presence of `if-none-match` on request headers to produce 304 response when file content has not been modified since the last request. 304 means file content still matches the previous etag. This parameter is optional and disabled by default.

### mtimeEnabled

`mtimeEnabled` parameter is a boolean enabled `mtime` headers. When enabled server sends `last-modified` response header and check presence of `if-modified-since` on request headers to be to produce 304 response when file has not been modified since the last request. 304 means file modification time on the filesystem is equal of before the previous modification time. This parameter is optional and disabled by default.

## canReadDirectory

`canReadDirectory` parameter is a boolean indicating if reading a directory is allowed. This parameter is optional with a default value of `false`.

When false `serveFile` respond with `403 not allowed to read directory` when `path` leads to a directory on your filesystem.

When true `serveFile` respond with `200` and response is a json string being an array of filenames inside the directory.
