import fetch from 'node-fetch';

/** 只回報已提交的人工批次；不讀取 PI。 */
export async function notifyBatchReadingResult(readings, alerts, options = {}) {
    const request = options.fetch || fetch;
    const env = options.env || process.env;
    try {
        const subscriptionId = Number(env.PIMCP_SUBSCRIPTION_ID || 3);
        if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
            throw new Error('PIMCP 訂閱編號無效');
        }
        const dates = [...new Set(readings.map(r =>
            new Date(Number(r.timestamp) + 8 * 3600000).toISOString().slice(0, 10)
        ))].sort();
        const dateLabel = dates.length === 1 ? dates[0] : `${dates[0]}～${dates.at(-1)}`;
        const details = alerts.map(a => `· ${a.tank_name || '未知儲槽'}：${a.reason || '液位變動異常'}`).join('\n');
        const message = `${dateLabel} 人工液位批次儲存完成\n已儲存 ${readings.length} 筆。\n`
            + (alerts.length ? `液位變動異常 ${alerts.length} 筆：\n${details}` : '本批次未發現超過人工液位變動門檻的異常。');
        const url = (env.PIMCP_API_URL || 'http://localhost:3011').replace(/\/$/, '');
        const response = await request(`${url}/api/notifications/external-api`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriptionId, title: 'WTCA 液位批次儲存結果', message, status: alerts.length ? 'warning' : 'success' }),
            signal: AbortSignal.timeout(10000)
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) {
            throw new Error(`PIMCP 未接受通知（HTTP ${response.status}）`);
        }
        return { sent: true };
    } catch (error) {
        console.error('[WTCA batch notification]', error.message);
        return { sent: false, error: '液位已儲存，但 PIMCP 通知未成功。請勿重複儲存。' };
    }
}
