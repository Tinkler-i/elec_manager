import { NextRequest, NextResponse } from 'next/server';
import { BACKUP_DIR, backupDatabase } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST() {
  try {
    // 必须 await：db.backup() 是异步的，等它把页拷完再回「成功」。
    // 这条路径原来漏了 await，接口返回时备份文件还没建出来（甚至备份失败也报成功）。
    const fileName = await backupDatabase();

    return NextResponse.json({
      message: '备份创建成功',
      fileName
    });
  } catch (error) {
    console.error('创建备份失败:', error);
    return NextResponse.json({ error: '创建备份失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');
    const deleteAll = searchParams.get('all') === 'true';
    const backupDir = BACKUP_DIR;

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
    console.error('删除备份失败:', error);
    return NextResponse.json({ error: '删除备份失败' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');

    if (fileName) {
      const backupDir = BACKUP_DIR;
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

    const backupDir = BACKUP_DIR;

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
    console.error('获取备份列表失败:', error);
    return NextResponse.json({ error: '获取备份列表失败' }, { status: 500 });
  }
}
