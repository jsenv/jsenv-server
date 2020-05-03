// https://github.com/digitalbazaar/forge/blob/master/examples/create-cert.js
// https://github.com/digitalbazaar/forge/issues/660#issuecomment-467145103

import { createRequire } from "module"

const require = createRequire(import.meta.url)
const forge = require("node-forge")

const { pki, sha256 } = forge

const certificateAttributes = {
  commonName: "https://github.com/jsenv/jsenv-server",
  countryName: "FR",
  ST: "Alpes Maritimes",
  localityName: "Valbonne",
  organizationName: "jsenv",
  OU: "jsenv server",
}

const certificateExtensions = {
  keyUsage: {
    critical: true,
    digitalSignature: true,
    keyEncipherment: true,
  },
  extKeyUsage: {
    serverAuth: true,
  },
  subjectAltName: {
    altNames: [
      {
        type: 7, // IP
        ip: "127.0.0.1",
      },
      {
        type: 2,
        value: "localhost",
      },
      {
        type: 2,
        value: "jsenv",
      },
    ],
  },
}

export const createCertificate = ({
  attributes = certificateAttributes,
  extensions = certificateExtensions,
  rootCertificatePem,
  rootCertificatePrivateKeyPem,
} = {}) => {
  const certificate = pki.createCertificate()
  const { privateKey, publicKey } = pki.rsa.generateKeyPair(2048)

  certificate.publicKey = publicKey
  certificate.serialNumber = "01" // randomSerialNumber()
  certificate.validity.notBefore = generateNotValideBeforeDate()
  certificate.validity.notAfter = generateNotValidAfterDate()
  certificate.setSubject(attributesToSubject(attributes))

  if (rootCertificatePem) {
    const rootCertificate = pki.certificateFromPem(rootCertificatePem)

    certificate.setIssuer(rootCertificate.subject.attributes)
    certificate.setExtensions(
      extensionToExtensionArray({
        authorityKeyIdentifier: {
          keyIdentifier: rootCertificate.generateSubjectKeyIdentifier().getBytes(),
        },
        ...extensions,
      }),
    )

    const rootCertificatePrivateKey = pki.privateKeyFromPem(rootCertificatePrivateKeyPem)
    certificate.sign(rootCertificatePrivateKey, sha256.create())
  } else {
    certificate.setIssuer(attributesToIssuer(attributes))
    certificate.setExtensions(extensionToExtensionArray(extensions))

    // self-sign certificate
    certificate.sign(privateKey, sha256.create())
  }

  return {
    publicKeyPem: pki.publicKeyToPem(publicKey),
    privateKeyPem: pki.privateKeyToPem(privateKey),
    certificatePem: pki.certificateToPem(certificate),
  }
}

export const createRootCertificate = () => {
  return createCertificate({
    attributes: certificateAttributes,
    extensions: {
      basicConstraints: {
        cA: true,
      },
      // authorityKeyIdentifier: {},
      // subjectKeyIdentifier: {},
    },
  })
}

const extensionToExtensionArray = (extensions) => {
  const extensionArray = []
  Object.keys(extensions).forEach((key) => {
    extensionArray.push({
      name: key,
      ...extensions[key],
    })
  })
  return extensionArray
}

const attributesToSubject = (attributes) => {
  const subject = []
  Object.keys(attributes).forEach((key) => {
    subject.push({
      ...(key === "OU" || key === "ST" ? { shortName: key } : { name: key }),
      value: attributes[key],
    })
  })
  return subject
}

const attributesToIssuer = attributesToSubject

const generateNotValideBeforeDate = () => {
  const date = new Date(Date.now() - 1000)
  return date
}

const generateNotValidAfterDate = () => {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 9)
  return date
}

const toPositiveHex = (hexString) => {
  var mostSiginficativeHexAsInt = parseInt(hexString[0], 8)
  if (mostSiginficativeHexAsInt < 8) {
    return hexString
  }

  mostSiginficativeHexAsInt -= 8
  return mostSiginficativeHexAsInt.toString() + hexString.substring(1)
}

// eslint-disable-next-line no-unused-vars
const randomSerialNumber = () => {
  return toPositiveHex(forge.util.bytesToHex(forge.random.getBytesSync(8)))
}
