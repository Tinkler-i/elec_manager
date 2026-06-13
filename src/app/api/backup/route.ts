import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST() {
  try {
    const db = getDb();
    const backupDir = path.join(process.cwd(), 'data', 'backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `elec-backup-${timestamp}.db`);

    db.backup(backupPath);

    return NextResponse.json({
      message: '备份创建成功',
      fileName: `elec-backup-${timestamp}.db`
    });
  } catch (error) {
    return NextResponse.json({ error: '创建备份失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');
    const deleteAll = searchParams.get('all') === 'true';
    const backupDir = path.join(process.cwd(), 'data', 'backups');

    if (deleteAll) {
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir).filter(file => file.endsWith('.db'));
        for (const file of files) {
          fs.unlinkSync(path.join(backupDir, file));
        }
      }
      return NextResponse.json({ message: '所有备份已删除' });
    }

    if (!fileName) {
      return NextResponse.json({ error: '未指定文件名' }, { status: 400 });
    }

    const safeName = path.basename(fileName);
    const filePath = path.join(backupDir, safeName);

    if (!safeName.endsWith('.db') || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: '备份文件不存在' }, { status: 404 });
    }

    fs.unlinkSync(filePath);
    return NextResponse.json({ message: '备份已删除' });
  } catch (error) {
    return NextResponse.json({ error: '删除备份失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');

    if (fileName) {
      const backupDir = path.join(process.cwd(), 'data', 'backups');
      const safeName = path.basename(fileName);
      const filePath = path.join(backupDir, safeName);

      if (!fs.existsSync(filePath) || !safeName.endsWith('.db')) {
        return NextResponse.json({ error: '备份文件不存在' }, { status: 404 });
      }

      const fileBuffer = fs.readFileSync(filePath);

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    const backupDir = path.join(process.cwd(), 'data', 'backups');

    if (!fs.existsSync(backupDir)) {
      return NextResponse.json([]);
    }

    const files = fs.readdirSync(backupDir)
      .filter(file => file.endsWith('.db'))
      .map(file => {
        const stats = fs.statSync(path.join(backupDir, file));
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime
        };
      })
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return NextResponse.json(files);
  } catch (error) {
    return NextResponse.json({ error: '获取备份列表失败' }, { status: 500 });
  }
}
