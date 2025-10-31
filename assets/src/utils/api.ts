/**
 * Fetch JSON from URL with automatic error handling
 */
export async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fetch text from URL with automatic error handling
 */
export async function fetchText(
  url: string,
  options?: RequestInit
): Promise<string> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
}

/**
 * Fetch with custom error message
 */
export async function fetchJsonWithError<T>(
  url: string,
  errorMessage: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return await response.json();
}

/**
 * Make a fetch request and only check if it succeeded (returns boolean)
 */
export async function fetchStatus(
  url: string,
  options?: RequestInit
): Promise<boolean> {
  const response = await fetch(url, options);
  return response.ok;
}

/**
 * Make a fetch request with side effects (mutations) that don't return data
 */
export async function fetchMutation(
  url: string,
  options?: RequestInit
): Promise<void> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

export async function assertResOK(res: Response): Promise<void> {
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error((await res.text()) || `Invalid status ${res.status}`);
  }
}
