import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const url = "https://www.reddit.com/r/vibecoding/hot.json?limit=3";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; reddit-catalog/1.0; +https://411-pi.vercel.app)",
        "Accept": "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body_preview: text.slice(0, 500),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
