export class ApiError extends Error {
  constructor(public status: number, public service: string) {
    super(`${service}: HTTP ${status}. ${status === 401 ? 'Reconnect your account.' : status === 403 ? 'Your account or app lacks permission.' : status === 429 ? 'Rate limited; try again later.' : 'The school service request failed.'}`);
  }
}
export async function request(url: string, init: RequestInit = {}, service = 'School API') {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new ApiError(response.status, service); }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(`${service}: network request failed or timed out.`, { cause: error });
  }
}
export async function boundedBytes(response: Response, limit = 20 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Document has no content.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Document exceeds the 20 MiB reading limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
