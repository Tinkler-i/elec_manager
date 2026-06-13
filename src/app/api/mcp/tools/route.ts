import { NextResponse } from 'next/server';
import { getToolInfoList } from '@/lib/mcp-tools';

export async function GET() {
  return NextResponse.json({ tools: getToolInfoList() });
}
