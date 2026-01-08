import { GoogleGenAI } from "@google/genai";
import { Reading, Tank } from "../types";

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API Key is missing. AI features will be disabled.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeUsagePatterns = async (
  tank: Tank,
  readings: Reading[],
  days: number
): Promise<string> => {
  const client = getAIClient();
  if (!client) return "請設定 API Key 以啟用 AI 分析功能。";

  // Filter last N days
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recentReadings = readings
    .filter(r => r.tankId === tank.id && r.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (recentReadings.length < 2) {
    return "數據不足，無法進行分析。請輸入更多液位紀錄。";
  }

  // Get current Specific Gravity from the latest reading
  const latestReading = recentReadings[recentReadings.length - 1];
  const currentSpecificGravity = latestReading ? latestReading.appliedSpecificGravity : '未知';

  // Format data for prompt
  const dataString = recentReadings.map(r => 
    `${new Date(r.timestamp).toLocaleDateString()}: 液位 ${r.levelCm}cm (${r.calculatedVolume.toFixed(1)}L), 補藥: ${r.addedAmountLiters}L, 比重: ${r.appliedSpecificGravity}`
  ).join('\n');

  const prompt = `
    你是一位專業的發電廠水處理工程師。請分析以下 "${tank.name}" (系統: ${tank.system}) 在過去 ${days} 天的藥劑使用數據。
    
    儲槽參數:
    - 容量: ${tank.capacityLiters} L
    - 警戒低液位: ${tank.safeMinLevel}%
    - 目前藥劑比重: ${currentSpecificGravity}

    數據紀錄:
    ${dataString}

    請提供以下分析 (請使用繁體中文，格式清晰):
    1. **用量趨勢**: 每日平均用量是否穩定？有無異常暴增或驟減？
    2. **補藥效率**: 補藥時機是否恰當 (是否過低才補，或太頻繁)？
    3. **異常偵測**: 根據液位變化邏輯 (液位應隨時間下降，除非補藥)，是否有數據輸入錯誤的可能性 (例如液位無故上升但未紀錄補藥)？
    4. **建議**: 給現場操作員的操作建議。
  `;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "無法生成分析報告。";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "AI 分析服務暫時無法使用，請稍後再試。";
  }
};