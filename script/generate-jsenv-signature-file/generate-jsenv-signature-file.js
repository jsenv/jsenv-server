import { resolveUrl, writeFile, urlToFileSystemPath } from "@jsenv/util"
import { createSelfSignature } from "./createSelfSignature.js"

const generateJsenvSignatureFile = async () => {
  const projectDirectoryUrl = resolveUrl("../../", import.meta.url)

  const signatureFileUrl = resolveUrl("./src/jsenvSignature.js", projectDirectoryUrl)
  const { publicKeyPem, privateKeyPem, certificatePem } = createSelfSignature()

  const pemToJavaScriptValue = (pem) => {
    pem = pem.replace(/\r\n/g, "\n")
    pem = pem.trim()
    return `\`${pem}\``
  }

  await writeFile(
    signatureFileUrl,
    `export const jsenvPrivateKey = ${pemToJavaScriptValue(privateKeyPem)}

  export const jsenvPublicKey = ${pemToJavaScriptValue(publicKeyPem)}

  export const jsenvCertificate = ${pemToJavaScriptValue(certificatePem)}
  `,
  )
  console.log(`-> ${urlToFileSystemPath(signatureFileUrl)}`)
}

generateJsenvSignatureFile()
