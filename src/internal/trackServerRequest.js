export const trackServerRequest = (nodeServer, fn, { http2 }) => {
  if (http2) {
    // see http2.js: we rely on https://nodejs.org/api/http2.html#http2_compatibility_api
    return trackHttp1ServerRequest(nodeServer, fn)
  }
  return trackHttp1ServerRequest(nodeServer, fn)
}

// const trackHttp2ServerRequest = (nodeServer, fn) => {
//   nodeServer.on("stream", fn)
//   return () => {
//     nodeServer.removeListener("stream", fn)
//   }
// }

const trackHttp1ServerRequest = (nodeServer, fn) => {
  nodeServer.on("request", fn)
  return () => {
    nodeServer.removeListener("request", fn)
  }
}
