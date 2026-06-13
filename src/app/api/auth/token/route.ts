import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, generateToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;

  if (token && verifyToken(token)) {
    return NextResponse.json({ token });
  }

  const newToken = generateToken();
  const response = NextResponse.json({ token: newToken });
  response.cookies.set('auth_token', newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
  });

  return response;
}
