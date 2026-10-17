import { SILENTFIX_VERSION } from "./types.js";

export const USER_AGENT = `silentfix/${SILENTFIX_VERSION}`;

export function githubToken(): string | undefined {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) return undefined;
  const trimmed = t.trim();
  return trimmed ? trimmed : undefined;
}

export async function httpGetBuffer(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      ...headers,
    },
    redirect: "follow",
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

export async function httpGetText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; text: string; body: Buffer }> {
  const r = await httpGetBuffer(url, headers);
  return { ...r, text: r.body.toString("utf8") };
}

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
