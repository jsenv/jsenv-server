import { resolveUrl, writeFile, urlToFileSystemPath } from "@jsenv/util"
import { createRootCertificate, createCertificate } from "./createCertificate.js"

const generateJsenvSignatureFile = async () => {
  const projectDirectoryUrl = resolveUrl("../../", import.meta.url)

  const signatureFileUrl = resolveUrl("./src/jsenvSignature.js", projectDirectoryUrl)

  const rootCertificate = createRootCertificate()
  const jsenvCertificate = createCertificate({
    rootCertificatePem: rootCertificate.certificatePem,
    rootCertificatePrivateKeyPem: rootCertificate.privateKeyPem,
  })

  const pemToJavaScriptValue = (pem) => {
    pem = pem.replace(/\r\n/g, "\n")
    pem = pem.trim()
    return `\`${pem}\``
  }

  await writeFile(
    signatureFileUrl,
    `export const jsenvRootCertificate = ${pemToJavaScriptValue(rootCertificate.certificatePem)}

export const jsenvPrivateKey = ${pemToJavaScriptValue(jsenvCertificate.privateKeyPem)}

export const jsenvPublicKey = ${pemToJavaScriptValue(jsenvCertificate.publicKeyPem)}

export const jsenvCertificate = ${pemToJavaScriptValue(jsenvCertificate.certificatePem)}
`,
  )
  console.log(`-> ${urlToFileSystemPath(signatureFileUrl)}`)
}

generateJsenvSignatureFile()
