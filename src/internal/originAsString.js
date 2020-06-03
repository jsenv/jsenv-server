import { networkInterfaces } from "os"
import { URL } from "url"

export const originAsString = ({ protocol, ip, port }) => {
  const url = new URL("https://127.0.0.1:80")

  url.protocol = protocol
  url.hostname = ipToExternalIp(ip)
  url.port = port
  return url.origin
}

const ipToExternalIp = (ip) => {
  if (ip === "0.0.0.0") return getExternalIp() || "0.0.0.0"

  return ip
}

const getExternalIp = () => {
  const networkInterfaceMap = networkInterfaces()
  let internalIPV4NetworkAddress

  Object.keys(networkInterfaceMap).find((key) => {
    const networkAddressArray = networkInterfaceMap[key]
    return networkAddressArray.find((networkAddress) => {
      if (networkAddress.internal) return false
      if (networkAddress.family !== "IPv4") return false
      internalIPV4NetworkAddress = networkAddress
      return true
    })
  })

  return internalIPV4NetworkAddress ? internalIPV4NetworkAddress.address : null
}
