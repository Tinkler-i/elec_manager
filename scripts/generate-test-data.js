const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'elec.db');
const db = new Database(DB_PATH);

// 首先清空现有数据
db.exec('DELETE FROM readings');
console.log('已清空现有读数数据');

// 设置初始读数为0
db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'initial_reading');
console.log('已重置初始读数为0');

// 生成测试数据：去年一月到现在
const startDate = new Date('2025-01-01');
const endDate = new Date();

let currentDate = new Date(startDate);
let previousReading = 0;
let readingValue = 100; // 起始电表读数

const insert = db.prepare(`
  INSERT INTO readings (id, reading_value, reading_date, previous_reading, notes, source, created_by, is_verified, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((readings) => {
  for (const reading of readings) {
    insert.run(...reading);
  }
});

const readings = [];

while (currentDate <= endDate) {
  const dateStr = currentDate.toISOString().split('T')[0];
  
  // 计算季节性用电模式
  const month = currentDate.getMonth(); // 0-11
  let baseUsage;
  
  // 夏季(6-8月)和冬季(12-2月)用电多，春秋季少
  if (month >= 5 && month <= 7) { // 夏季
    baseUsage = 15 + Math.random() * 10; // 15-25度
  } else if (month >= 11 || month <= 1) { // 冬季
    baseUsage = 12 + Math.random() * 8; // 12-20度
  } else { // 春秋季
    baseUsage = 8 + Math.random() * 7; // 8-15度
  }
  
  // 添加周末用电增加
  const dayOfWeek = currentDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    baseUsage *= 1.2;
  }
  
  // 添加随机波动
  const usage = Math.round(baseUsage * 10) / 10;
  
  // 更新电表读数
  const newReading = Math.round((readingValue + usage) * 10) / 10;
  
  const id = uuidv4();
  const createdAt = new Date(currentDate.getTime() + Math.random() * 24 * 60 * 60 * 1000);
  
  readings.push([
    id,
    newReading,
    dateStr,
    previousReading,
    `测试数据第${Math.floor((currentDate - startDate) / (24 * 60 * 60 * 1000)) + 1}天`,
    'manual',
    'user',
    0,
    createdAt.toISOString().replace('T', ' ').substring(0, 19)
  ]);
  
  previousReading = newReading;
  readingValue = newReading;
  
  // 移动到下一天
  currentDate.setDate(currentDate.getDate() + 1);
}

insertMany(readings);
console.log(`已生成 ${readings.length} 条测试数据`);
console.log(`数据范围: ${startDate.toISOString().split('T')[0]} 至 ${endDate.toISOString().split('T')[0]}`);
console.log(`最终电表读数: ${readingValue} 度`);
console.log(`总用电量: ${readingValue - 100} 度`);

db.close();