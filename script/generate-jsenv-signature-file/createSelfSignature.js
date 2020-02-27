// https://github.com/digitalbazaar/forge/blob/master/examples/create-cert.js
// https://github.com/digitalbazaar/forge/issues/660#issuecomment-467145103

import { createRequire } from "module"

const require = createRequire(import.meta.url)
const forge = require("node-forge")

export const createSelfSignature = () => {
  const { pki, sha256 } = forge

  const certificate = pki.createCertificate()
  const { privateKey, publicKey } = pki.rsa.generateKeyPair(1024)
  certificate.publicKey = publicKey
  certificate.serialNumber = randomSerialNumber()
  certificate.validity.notBefore = generateNotValideBeforeDate()
  certificate.validity.notAfter = generateNotValidAfterDate()
  const certificateAttributes = [
    {
      name: "commonName",
      value: "https://github.com/jsenv/jsenv-server",
    },
    {
      name: "countryName",
      value: "FR",
    },
    {
      shortName: "ST",
      value: "Alpes Maritimes",
    },
    {
      name: "localityName",
      value: "Valbonne",
    },
    {
      name: "organizationName",
      value: "jsenv",
    },
    {
      shortName: "OU",
      value: "jsenv server",
    },
  ]
  certificate.setSubject(certificateAttributes)
  certificate.setIssuer(certificateAttributes)
  const certificateExtensions = [
    {
      name: "basicConstraints",
      critical: true,
      cA: false,
    },
    {
      name: "keyUsage",
      critical: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
    },
    {
      name: "authorityKeyIdentifier",
      keyIdentifier: certificate.generateSubjectKeyIdentifier().getBytes(),
    },
    {
      name: "subjectAltName",
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
  ]
  certificate.setExtensions(certificateExtensions)

  // self-sign certificate
  certificate.sign(privateKey, sha256.create())

  return {
    publicKeyPem: pki.publicKeyToPem(publicKey),
    privateKeyPem: pki.privateKeyToPem(privateKey),
    certificatePem: pki.certificateToPem(certificate),
  }
}

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
  var mostSiginficativeHexAsInt = parseInt(hexString[0], 16)
  if (mostSiginficativeHexAsInt < 8) {
    return hexString
  }

  mostSiginficativeHexAsInt -= 8
  return mostSiginficativeHexAsInt.toString() + hexString.substring(1)
}

const randomSerialNumber = () => {
  return toPositiveHex(forge.util.bytesToHex(forge.random.getBytesSync(16)))
}
