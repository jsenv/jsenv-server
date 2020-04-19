export const readRequestBodyAsString = (body) => {
  return new Promise((resolve, reject) => {
    const bufferArray = []
    body.subscribe({
      error: reject,
      next: (buffer) => {
        bufferArray.push(buffer)
      },
      complete: () => {
        const bodyAsBuffer = Buffer.concat(bufferArray)
        const bodyAsString = bodyAsBuffer.toString()
        resolve(bodyAsString)
      },
    })
  })
}
