export const urlToSearchParamValue = (url, searchParamName) => {
  return new URL(url).searchParams.get(searchParamName)
}
