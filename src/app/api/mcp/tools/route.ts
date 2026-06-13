import { NextResponse } from 'next/server';
import { getToolInfoList } from '@/lib/mcp-server';

export async function GET() {
  return NextResponse.json({ tools: getToolInfoList() });
}
