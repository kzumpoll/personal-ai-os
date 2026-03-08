import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.DASHBOARD_PASSWORD;

  if (!correct || password !== correct) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const from = req.nextUrl.searchParams.get('from') ?? '/';
  const res = NextResponse.redirect(new URL(from, req.url));
  res.cookies.set('dash_auth', correct, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
