import { type NextRequest, NextResponse } from "next/server";

const BACKEND = (process.env.QLAB_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const url = new URL(req.url);
  const target = `${BACKEND}/${params.path.join("/")}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (k !== "host") headers.set(k, v);
  });

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  const res = await fetch(target, { method: req.method, headers, body });

  const resHeaders = new Headers();
  res.headers.forEach((v, k) => resHeaders.set(k, v));

  return new NextResponse(res.body, { status: res.status, headers: resHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
