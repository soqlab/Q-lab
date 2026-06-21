import { type NextRequest, NextResponse } from "next/server";

const BACKEND = (process.env.QLAB_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const url = new URL(req.url);
    const target = `${BACKEND}/${params.path.join("/")}${url.search}`;

    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (k !== "host" && k !== "content-length") headers.set(k, v);
    });

    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.text();
    }

    const res = await fetch(target, { method: req.method, headers, body });
    const text = await res.text();

    const resHeaders = new Headers();
    res.headers.forEach((v, k) => {
      if (k !== "content-encoding" && k !== "transfer-encoding") {
        resHeaders.set(k, v);
      }
    });

    return new NextResponse(text, { status: res.status, headers: resHeaders });
  } catch (e) {
    return NextResponse.json(
      { error: "Proxy error", detail: String(e), backend: BACKEND },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
