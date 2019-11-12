const { writeFileSync } = require("fs")
const { pathToFileURL, fileURLToPath } = require("url")
const { createSelfSignature } = require("./createSelfSignature.js")

const { publicKeyPem, privateKeyPem, certificatePem } = createSelfSignature()

const jsenvServerDirectoryUrl = new URL("../../", pathToFileURL(__filename))
const signatureFileUrl = new URL("./src/jsenvSignature.js", jsenvServerDirectoryUrl)
const signatureFilePath = fileURLToPath(signatureFileUrl)

const pemToJavaScriptValue = (pem) => {
  pem = pem.replace(/\r\n/g, "\n")
  pem = pem.trim()
  return `\`${pem}\``
}

writeFileSync(
  signatureFilePath,
  `export const jsenvPrivateKey = ${pemToJavaScriptValue(privateKeyPem)}

export const jsenvPublicKey = ${pemToJavaScriptValue(publicKeyPem)}

export const jsenvCertificate = ${pemToJavaScriptValue(certificatePem)}
`,
)
console.log(`-> ${signatureFilePath}`)
