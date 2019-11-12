import { URLSearchParams } from "url"

export const ressourceToSearchParamValue = (ressource, searchParamName) => {
  const search = ressourceToSearch(ressource)
  return new URLSearchParams(search).get(searchParamName)
}

const ressourceToSearch = (ressource) => {
  const searchSeparatorIndex = ressource.indexOf("?")
  return searchSeparatorIndex === -1 ? "?" : ressource.slice(searchSeparatorIndex)
}
