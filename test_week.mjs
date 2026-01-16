// 測試週起始日計算邏輯

function getWeekStart(date) {
    const dayNum = date.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const daysSinceMonday = (dayNum + 6) % 7;
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

const testDates = [
    new Date('2026-01-13'), // 星期二
    new Date('2026-01-12'), // 星期一
    new Date('2026-01-11'), // 星期日
    new Date('2026-01-10'), // 星期六
    new Date('2026-01-14'), // 星期三
];

const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

console.log('=== 週起始日測試 (星期一為週開始) ===\n');

testDates.forEach(date => {
    const weekStart = getWeekStart(date);
    const dayName = dayNames[date.getDay()];
    const weekStartDayName = dayNames[weekStart.getDay()];

    console.log(`日期: ${date.toLocaleDateString('zh-TW')} (${dayName})`);
    console.log(`  週開始: ${weekStart.toLocaleDateString('zh-TW')} (${weekStartDayName})`);
    console.log(`  預期: 週開始應該是星期一`);
    console.log(`  結果: ${weekStartDayName === '星期一' ? '✅ 正確' : '❌ 錯誤'}`);
    console.log('');
});

// 驗證同一週的日期應該有相同的週開始
console.log('=== 驗證同一週的日期 ===\n');
const week = [
    new Date('2026-01-12'), // 星期一
    new Date('2026-01-13'), // 星期二
    new Date('2026-01-14'), // 星期三
    new Date('2026-01-15'), // 星期四
    new Date('2026-01-16'), // 星期五
    new Date('2026-01-17'), // 星期六
    new Date('2026-01-18'), // 星期日
];

const weekStarts = week.map(d => getWeekStart(d).toLocaleDateString('zh-TW'));
const allSame = weekStarts.every(ws => ws === weekStarts[0]);

console.log('同一週 (2026/1/12 - 2026/1/18) 的週開始:');
week.forEach((d, i) => {
    console.log(`  ${d.toLocaleDateString('zh-TW')} (${dayNames[d.getDay()]}): ${weekStarts[i]}`);
});
console.log(`\n結果: ${allSame ? '✅ 所有日期的週開始都相同' : '❌ 週開始不一致'}`);
console.log(`週開始日期: ${weekStarts[0]} (應該是 2026/1/12, 星期一)`);
