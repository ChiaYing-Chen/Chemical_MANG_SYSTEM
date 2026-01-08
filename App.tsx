import React, { useState, useEffect, useMemo } from 'react';
import { StorageService } from './services/storageService';
import { Tank, Reading, SystemType, ChemicalSupply, CWSParameterRecord, BWSParameterRecord } from './types';
import { Icons } from './components/Icons';
import * as XLSX from 'xlsx';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, ComposedChart, Area
} from 'recharts';

// --- Helper Components ---

const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }> = ({ children, className = "", title, action }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
    {(title || action) && (
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }> = ({ children, variant = 'primary', className = "", ...props }) => {
  const baseStyle = "inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100"
  };
  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

// Common input styles
const inputClassName = "w-full rounded-lg border-slate-600 border p-2.5 bg-slate-900 text-white placeholder-slate-400 focus:ring-brand-500 focus:border-brand-500";

// --- Utility Functions ---

const readExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
};

const formatDateForInput = (date: any): string => {
  if (!date) return "";
  try {
    const d = new Date(date);
    if(isNaN(d.getTime())) return "";
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset*60*1000));
    return localDate.toISOString().split('T')[0];
  } catch { 
    return ""; 
  }
};

const parseDateKey = (key: string): Date | null => {
  const d = new Date(key);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  
  const currentYear = new Date().getFullYear();
  const d2 = new Date(`${currentYear}/${key}`);
  if (!isNaN(d2.getTime())) return d2;

  return null;
}

// --- Views ---

const TankStatusCard: React.FC<{ tank: any }> = ({ tank }) => {
    return (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:border-brand-300 transition-colors relative overflow-hidden">
            {tank.isLow && (
                 <div className="absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 bg-red-100 rounded-full flex items-end justify-start pl-3 pb-3">
                     <Icons.Alert className="w-5 h-5 text-red-500" />
                 </div>
            )}

            <div className="flex justify-between items-start mb-3 pr-4">
                <h3 className="font-bold text-slate-800 text-base">{tank.name.split(' ').pop()}</h3>
                <div className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    {tank.name.split(' ')[0]}
                </div>
            </div>

            <div className="space-y-3">
                <div>
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">存量</span>
                        <span className={`font-bold ${tank.isLow ? 'text-red-600' : 'text-slate-700'}`}>
                            {tank.lastReading?.calculatedVolume.toFixed(0) || 0} L
                        </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                        <div 
                            className={`h-2 rounded-full transition-all duration-500 ${tank.isLow ? 'bg-red-500' : 'bg-brand-500'}`}
                            style={{ width: `${Math.min(100, Math.max(0, tank.currentLevel))}%` }}
                        ></div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-50 pt-2">
                    <div>
                         <span className="text-slate-400 block">液位 (H)</span>
                         <span className="font-medium text-slate-700">{tank.lastReading?.levelCm || 0} cm</span>
                    </div>
                    <div className="text-right">
                         <span className="text-slate-400 block">重量 (W)</span>
                         <span className="font-medium text-slate-700">{tank.lastReading?.calculatedWeightKg.toFixed(0) || 0} kg</span>
                    </div>
                </div>

                <div className="text-[10px] text-slate-400 flex items-center justify-end mt-1">
                    <Icons.ClipboardPen className="w-3 h-3 mr-1 opacity-50" />
                    {tank.lastReading ? new Date(tank.lastReading.timestamp).toLocaleDateString() : '無紀錄'}
                </div>
            </div>
        </div>
    );
}

const DashboardView: React.FC<{ tanks: Tank[], readings: Reading[] }> = ({ tanks, readings }) => {
  const tanksWithStatus = useMemo(() => {
      return tanks.map(tank => {
        const tankReadings = readings.filter(r => r.tankId === tank.id).sort((a, b) => b.timestamp - a.timestamp);
        const lastReading = tankReadings[0];
        const currentLevel = lastReading ? (lastReading.calculatedVolume / tank.capacityLiters) * 100 : 0;
        const isLow = currentLevel < tank.safeMinLevel;
        return { ...tank, currentLevel, lastReading, isLow };
      });
  }, [tanks, readings]);

  const groups = useMemo(() => {
      return {
          coolingArea1: tanksWithStatus.filter(t => t.system === SystemType.COOLING && (t.name.includes('CWS-1') || t.description?.includes('一階'))),
          coolingArea2: tanksWithStatus.filter(t => t.system === SystemType.COOLING && (t.name.includes('CWS-2') || t.description?.includes('二階'))),
          boiler: tanksWithStatus.filter(t => t.system === SystemType.BOILER),
          denox: tanksWithStatus.filter(t => t.system === SystemType.DENOX),
          others: tanksWithStatus.filter(t => 
              t.system !== SystemType.COOLING && 
              t.system !== SystemType.BOILER && 
              t.system !== SystemType.DENOX
          )
      };
  }, [tanksWithStatus]);

  const lowLevelCount = tanksWithStatus.filter(t => t.isLow).length;

  return (
    <div className="space-y-8 animate-fade-in">
        {lowLevelCount > 0 && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r shadow-sm flex items-center justify-between">
                <div className="flex items-center text-red-700">
                    <Icons.Alert className="w-5 h-5 mr-2" />
                    <span className="font-bold">系統警示：目前有 {lowLevelCount} 個儲槽液位低於警戒值，請盡速安排補藥。</span>
                </div>
            </div>
        )}

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-sky-50 px-6 py-4 border-b border-sky-100 flex items-center gap-3">
                <div className="p-2 bg-sky-200 rounded-lg text-sky-700">
                    <Icons.Cooling className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-sky-900">冷卻水系統</h2>
                    <p className="text-xs text-sky-600">Cooling Water System (CWS)</p>
                </div>
            </div>
            
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">一階桶槽區</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {groups.coolingArea1.map(t => <TankStatusCard key={t.id} tank={t} />)}
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center after:content-[''] after:flex-1 after:h-px after:bg-slate-200 after:ml-4">
                        <span className="bg-slate-100 px-2 py-1 rounded text-slate-600">二階桶槽區</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {groups.coolingArea2.map(t => <TankStatusCard key={t.id} tank={t} />)}
                    </div>
                </div>
            </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <section className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-orange-50 px-6 py-4 border-b border-orange-100 flex items-center gap-3">
                    <div className="p-2 bg-orange-200 rounded-lg text-orange-700">
                        <Icons.Boiler className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-orange-900">鍋爐水系統</h2>
                        <p className="text-xs text-orange-600">Boiler Water System (BWS)</p>
                    </div>
                </div>
                <div className="p-6">
                     <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {groups.boiler.map(t => <TankStatusCard key={t.id} tank={t} />)}
                    </div>
                </div>
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-3">
                    <div className="p-2 bg-emerald-200 rounded-lg text-emerald-700">
                        <Icons.DeNOx className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-emerald-900">脫銷系統</h2>
                        <p className="text-xs text-emerald-600">DeNOx (SCR)</p>
                    </div>
                </div>
                <div className="p-6">
                     <div className="grid grid-cols-1 gap-4">
                        {groups.denox.map(t => <TankStatusCard key={t.id} tank={t} />)}
                    </div>
                </div>
            </section>
        </div>

        {groups.others.length > 0 && (
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-3">
                    <Icons.Factory className="w-5 h-5 text-slate-500" />
                    <h2 className="text-lg font-bold text-slate-700">其他系統</h2>
                </div>
                <div className="p-6">
                     <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {groups.others.map(t => <TankStatusCard key={t.id} tank={t} />)}
                    </div>
                </div>
            </section>
        )}
    </div>
  );
};

const DataEntryView: React.FC<{ 
  tanks: Tank[], 
  readings: Reading[],
  onSave: (r: Reading) => void,
  onBatchSave: (rs: Reading[]) => void,
  onUpdateTank: (t: Tank) => void
}> = ({ tanks, readings, onSave, onBatchSave, onUpdateTank }) => {
  const [activeType, setActiveType] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [file, setFile] = useState<File | null>(null);
  const [selectedTankId, setSelectedTankId] = useState<string>(tanks[0]?.id || '');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [levelCm, setLevelCm] = useState<string>('');
  const [customSG, setCustomSG] = useState<string>('');
  const [operator, setOperator] = useState<string>('');
  const [activeSupply, setActiveSupply] = useState<ChemicalSupply | undefined>(undefined);
  const [lastReadingSG, setLastReadingSG] = useState<number | null>(null);
  const [newSupply, setNewSupply] = useState<Partial<ChemicalSupply>>({});
  const [cwsInput, setCwsInput] = useState<Partial<CWSParameterRecord>>({});
  const [bwsInput, setBwsInput] = useState<Partial<BWSParameterRecord>>({});

  const selectedTank = tanks.find(t => t.id === selectedTankId);

  useEffect(() => {
    if (activeType === 'A' && selectedTankId && date) {
      const timestamp = new Date(date).getTime();
      const supply = StorageService.getActiveSupply(selectedTankId, timestamp);
      setActiveSupply(supply);

      const tankReadings = readings
        .filter(r => r.tankId === selectedTankId && r.timestamp < timestamp)
        .sort((a, b) => b.timestamp - a.timestamp);
      
      if (tankReadings.length > 0) {
        setLastReadingSG(tankReadings[0].appliedSpecificGravity);
      } else {
        setLastReadingSG(null);
      }
    }
  }, [selectedTankId, date, readings, activeType]);

  const handleSubmitReadings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTank) return;
    
    let finalSG = 1.0;
    if (customSG && parseFloat(customSG) > 0) finalSG = parseFloat(customSG);
    else if (lastReadingSG) finalSG = lastReadingSG;
    else if (activeSupply) finalSG = activeSupply.specificGravity;

    const vol = parseFloat(levelCm) * selectedTank.factor;
    const weight = vol * finalSG;

    const newReading: Reading = {
      id: Date.now().toString(),
      tankId: selectedTankId,
      timestamp: new Date(date).getTime(),
      levelCm: parseFloat(levelCm),
      calculatedVolume: vol,
      calculatedWeightKg: weight,
      appliedSpecificGravity: finalSG,
      supplyId: activeSupply?.id,
      addedAmountLiters: 0,
      operatorName: operator
    };

    onSave(newReading);
    setLevelCm('');
    setCustomSG('');
    alert('Table A: 液位紀錄已儲存');
  };

  const handleSubmitContract = (e: React.FormEvent) => {
      e.preventDefault();
      if(!newSupply.tankId || !newSupply.supplierName || !newSupply.specificGravity || !newSupply.startDate) {
          alert("請填寫所有必要欄位");
          return;
      }
      const supply: ChemicalSupply = {
        id: Date.now().toString(),
        tankId: newSupply.tankId,
        supplierName: newSupply.supplierName,
        chemicalName: newSupply.chemicalName || '',
        specificGravity: Number(newSupply.specificGravity),
        price: newSupply.price ? Number(newSupply.price) : undefined,
        startDate: new Date(newSupply.startDate).getTime(),
        notes: newSupply.notes
    } as ChemicalSupply;
    
    StorageService.saveSupply(supply);
    setNewSupply({});
    alert('Table B: 合約紀錄已儲存');
  }

  const handleSubmitCWS = (e: React.FormEvent) => {
      e.preventDefault();
      if (!cwsInput.tankId) return;
      
      const record: CWSParameterRecord = {
          tankId: cwsInput.tankId,
          circulationRate: Number(cwsInput.circulationRate) || 0,
          tempDiff: Number(cwsInput.tempDiff) || 0,
          cwsHardness: Number(cwsInput.cwsHardness) || 0,
          makeupHardness: Number(cwsInput.makeupHardness) || 0,
          concentrationCycles: 1, 
          targetPpm: Number(cwsInput.targetPpm) || 0,
          tempOutlet: Number(cwsInput.tempOutlet) || 0,
          tempReturn: Number(cwsInput.tempReturn) || 0
      };
      
      StorageService.saveCWSParam(record);
      onUpdateTank(tanks.find(t => t.id === cwsInput.tankId)!);
      setCwsInput({});
      alert('Table C: 冷卻水參數已儲存');
  }

  const handleSubmitBWS = (e: React.FormEvent) => {
      e.preventDefault();
      if (!bwsInput.tankId) return;

      const record: BWSParameterRecord = {
          tankId: bwsInput.tankId,
          steamProduction: Number(bwsInput.steamProduction) || 0,
          targetPpm: Number(bwsInput.targetPpm) || 0
      };

      StorageService.saveBWSParam(record);
      onUpdateTank(tanks.find(t => t.id === bwsInput.tankId)!);
      setBwsInput({});
      alert('Table D: 鍋爐水參數已儲存');
  }

  const processExcel = async () => {
    if (!file) return;

    try {
      const jsonData = await readExcelFile(file);
      let successCount = 0;

      if (activeType === 'A') {
          const newReadings: Reading[] = [];
          for (const row of jsonData) {
              const tankName = row['儲槽名稱'] || row['TankName'] || row['儲槽'];
              if (!tankName) continue;
              const targetTank = tanks.find(t => t.name.trim() === String(tankName).trim());
              if (!targetTank) continue;

              const keys = Object.keys(row);
              for (const key of keys) {
                  const readingDate = parseDateKey(key);
                  if (readingDate) {
                      const levelVal = row[key];
                      if (levelVal !== undefined && levelVal !== '' && !isNaN(Number(levelVal))) {
                          const timestamp = readingDate.getTime();
                          const lvl = parseFloat(levelVal);
                          const supply = StorageService.getActiveSupply(targetTank.id, timestamp);
                          const sg = supply?.specificGravity || 1.0;
                          const vol = lvl * targetTank.factor;

                          newReadings.push({
                              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                              tankId: targetTank.id,
                              timestamp: timestamp,
                              levelCm: lvl,
                              calculatedVolume: vol,
                              calculatedWeightKg: vol * sg,
                              appliedSpecificGravity: sg,
                              supplyId: supply?.id,
                              addedAmountLiters: 0,
                              operatorName: 'Batch Import'
                          });
                          successCount++;
                      }
                  }
              }
          }
          if (successCount > 0) onBatchSave(newReadings);
      } else if (activeType === 'B') {
          const newSupplies: ChemicalSupply[] = [];
          for (const row of jsonData) {
             const dateRaw = row['生效日期'] || row['Date'];
             const supplier = row['供應商'] || row['Supplier'];
             const chem = row['藥劑名稱'] || row['Chemical'];
             const tankName = row['適用儲槽'] || row['Tank'];
             const sg = row['比重'] || row['SG'];
             
             if (dateRaw && supplier && tankName && sg) {
                 const t = tanks.find(t => t.name.trim() === String(tankName).trim());
                 if (!t) continue;
                 
                 const dateStr = formatDateForInput(dateRaw);
                 if (!dateStr) continue;

                 newSupplies.push({
                     id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                     tankId: t.id,
                     supplierName: supplier,
                     chemicalName: chem || '',
                     specificGravity: parseFloat(sg),
                     price: row['單價'] || row['Price'] ? parseFloat(row['單價'] || row['Price']) : undefined,
                     startDate: new Date(dateStr).getTime(),
                     notes: row['備註'] || row['Notes'] || ''
                 });
                 successCount++;
             }
          }
          if (successCount > 0) StorageService.addSuppliesBatch(newSupplies);
      } else if (activeType === 'C') {
          for (const row of jsonData) {
              const tankName = row['儲槽名稱'] || row['Tank'];
              if (!tankName) continue;
              const t = tanks.find(tank => tank.name.trim() === String(tankName).trim());
              if (!t) continue;

              const record: CWSParameterRecord = {
                  tankId: t.id,
                  circulationRate: parseFloat(row['循環水量'] || row['R']) || 0,
                  tempDiff: parseFloat(row['溫差'] || row['DeltaT']) || 0,
                  cwsHardness: parseFloat(row['冷卻水硬度'] || row['CWSHardness']) || 0,
                  makeupHardness: parseFloat(row['補水硬度'] || row['MakeupHardness']) || 0,
                  targetPpm: parseFloat(row['目標濃度'] || row['TargetPPM']) || 0,
                  concentrationCycles: 1,
                  tempOutlet: parseFloat(row['出水溫'] || row['T1']) || 0,
                  tempReturn: parseFloat(row['回水溫'] || row['T2']) || 0
              };
              StorageService.saveCWSParam(record);
              onUpdateTank(t);
              successCount++;
          }
      } else if (activeType === 'D') {
           for (const row of jsonData) {
              const tankName = row['儲槽名稱'] || row['Tank'];
              if (!tankName) continue;
              const t = tanks.find(tank => tank.name.trim() === String(tankName).trim());
              if (!t) continue;

              const record: BWSParameterRecord = {
                  tankId: t.id,
                  steamProduction: parseFloat(row['蒸氣量'] || row['Steam']) || 0,
                  targetPpm: parseFloat(row['目標濃度'] || row['TargetPPM']) || 0
              };
              StorageService.saveBWSParam(record);
              onUpdateTank(t);
              successCount++;
          }
      }

      alert(`匯入完成! 成功處理 ${successCount} 筆資料 (Type ${activeType})`);
      setFile(null);

    } catch (e) {
      console.error(e);
      alert('檔案讀取失敗，請確認格式。');
    }
  };

  const handleExport = () => {
    const data = readings.map(r => {
        const t = tanks.find(tank => tank.id === r.tankId);
        return {
            'Date': new Date(r.timestamp).toLocaleDateString(),
            'Tank': t ? t.name : r.tankId,
            'Level (cm)': r.levelCm,
            'Volume (L)': r.calculatedVolume.toFixed(2),
            'Weight (kg)': r.calculatedWeightKg.toFixed(2),
            'SG': r.appliedSpecificGravity,
            'Operator': r.operatorName
        };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Readings");
    XLSX.writeFile(wb, "PowerChem_Readings.xlsx");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-200 grid grid-cols-4 gap-2">
          <button 
              onClick={() => setActiveType('A')}
              className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'A' ? 'bg-blue-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
              <Icons.Entry className="w-4 h-4 mr-2" />
              A. 液位數據
          </button>
          <button 
              onClick={() => setActiveType('B')}
              className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'B' ? 'bg-purple-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
              <Icons.ClipboardPen className="w-4 h-4 mr-2" />
              B. 藥劑合約
          </button>
          <button 
              onClick={() => setActiveType('C')}
              className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'C' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
              <Icons.Cooling className="w-4 h-4 mr-2" />
              C. 冷卻水參數
          </button>
          <button 
              onClick={() => setActiveType('D')}
              className={`flex items-center justify-center py-3 rounded-lg text-sm font-bold transition-all
              ${activeType === 'D' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
              <Icons.Boiler className="w-4 h-4 mr-2" />
              D. 鍋爐水參數
          </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card 
              title={
                  activeType === 'A' ? "手動輸入 - 液位紀錄" :
                  activeType === 'B' ? "手動輸入 - 合約資料" :
                  activeType === 'C' ? "手動輸入 - 冷卻水參數" : "手動輸入 - 鍋爐水參數"
              }
              className={`border-t-4 ${
                  activeType === 'A' ? 'border-t-blue-500' :
                  activeType === 'B' ? 'border-t-purple-500' :
                  activeType === 'C' ? 'border-t-sky-500' : 'border-t-orange-500'
              }`}
          >
              {activeType === 'A' && (
                  <form onSubmit={handleSubmitReadings} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽</label>
                          <select value={selectedTankId} onChange={e => setSelectedTankId(e.target.value)} className={inputClassName} required>
                              {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.system})</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">2. 抄表日期</label>
                          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClassName} required />
                      </div>
                      <div className="p-3 bg-blue-50 rounded border border-blue-100 text-sm text-blue-900">
                          <div className="flex justify-between">
                             <span>當期合約: {activeSupply?.supplierName || '無'}</span>
                             <span className="font-bold">比重: {lastReadingSG || activeSupply?.specificGravity || 1.0}</span>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">液位高度 (cm)</label>
                              <input type="number" step="0.1" value={levelCm} onChange={e => setLevelCm(e.target.value)} className={inputClassName} placeholder="H" required />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">自訂比重 (選填)</label>
                              <input type="number" step="0.001" value={customSG} onChange={e => setCustomSG(e.target.value)} className={inputClassName} placeholder="SG" />
                          </div>
                      </div>
                      <div className="pt-2">
                          <Button type="submit" className="w-full justify-center">儲存液位紀錄</Button>
                      </div>
                  </form>
              )}

              {activeType === 'B' && (
                  <form onSubmit={handleSubmitContract} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">1. 適用儲槽</label>
                          <select 
                            value={newSupply.tankId || ''} 
                            onChange={e => setNewSupply({...newSupply, tankId: e.target.value})} 
                            className={inputClassName} 
                            required
                          >
                              <option value="">-- 請選擇 --</option>
                              {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">2. 供應商</label>
                          <input type="text" value={newSupply.supplierName || ''} onChange={e => setNewSupply({...newSupply, supplierName: e.target.value})} className={inputClassName} required placeholder="例如: 台塑" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">藥劑名稱</label>
                              <input type="text" value={newSupply.chemicalName || ''} onChange={e => setNewSupply({...newSupply, chemicalName: e.target.value})} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">比重 (SG)</label>
                              <input type="number" step="0.001" value={newSupply.specificGravity || ''} onChange={e => setNewSupply({...newSupply, specificGravity: parseFloat(e.target.value)})} className={inputClassName} required placeholder="1.0" />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">單價 (元/kg)</label>
                              <input type="number" step="0.1" value={newSupply.price || ''} onChange={e => setNewSupply({...newSupply, price: parseFloat(e.target.value)})} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">生效日期</label>
                              <input type="date" onChange={e => setNewSupply({...newSupply, startDate: e.target.value as any})} className={inputClassName} required />
                          </div>
                      </div>
                      <div className="pt-2">
                          <Button type="submit" className="w-full justify-center bg-purple-600 hover:bg-purple-700">儲存合約紀錄</Button>
                      </div>
                  </form>
              )}

              {activeType === 'C' && (
                  <form onSubmit={handleSubmitCWS} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽 (僅限 CWS)</label>
                          <select 
                            value={cwsInput.tankId || ''} 
                            onChange={e => setCwsInput({...cwsInput, tankId: e.target.value})} 
                            className={inputClassName} 
                            required
                          >
                              <option value="">-- 請選擇 --</option>
                              {tanks.filter(t => t.system === SystemType.COOLING).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">循環水量 R (m3/h)</label>
                              <input type="number" value={cwsInput.circulationRate || ''} onChange={e => setCwsInput({...cwsInput, circulationRate: parseFloat(e.target.value)})} className={inputClassName} placeholder="R" />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">溫差 ΔT (°C)</label>
                              <input type="number" step="0.1" value={cwsInput.tempDiff || ''} onChange={e => setCwsInput({...cwsInput, tempDiff: parseFloat(e.target.value)})} className={inputClassName} placeholder="dT" />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">冷卻水硬度 (ppm)</label>
                              <input type="number" value={cwsInput.cwsHardness || ''} onChange={e => setCwsInput({...cwsInput, cwsHardness: parseFloat(e.target.value)})} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">補水硬度 (ppm)</label>
                              <input type="number" value={cwsInput.makeupHardness || ''} onChange={e => setCwsInput({...cwsInput, makeupHardness: parseFloat(e.target.value)})} className={inputClassName} />
                          </div>
                          <div className="col-span-2">
                              <label className="block text-sm font-medium text-slate-700 mb-1">目標藥劑濃度 (ppm)</label>
                              <input type="number" step="0.1" value={cwsInput.targetPpm || ''} onChange={e => setCwsInput({...cwsInput, targetPpm: parseFloat(e.target.value)})} className={inputClassName} />
                          </div>
                      </div>
                      <div className="pt-2">
                          <Button type="submit" className="w-full justify-center bg-sky-600 hover:bg-sky-700">更新 CWS 參數</Button>
                      </div>
                  </form>
              )}

              {activeType === 'D' && (
                  <form onSubmit={handleSubmitBWS} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">1. 選擇儲槽 (僅限 BWS)</label>
                          <select 
                            value={bwsInput.tankId || ''} 
                            onChange={e => setBwsInput({...bwsInput, tankId: e.target.value})} 
                            className={inputClassName} 
                            required
                          >
                              <option value="">-- 請選擇 --</option>
                              {tanks.filter(t => t.system === SystemType.BOILER).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">月平均蒸氣產量 (Ton/Month)</label>
                          <input type="number" value={bwsInput.steamProduction || ''} onChange={e => setBwsInput({...bwsInput, steamProduction: parseFloat(e.target.value)})} className={inputClassName} placeholder="Steam" />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">目標藥劑濃度 (ppm)</label>
                          <input type="number" step="0.1" value={bwsInput.targetPpm || ''} onChange={e => setBwsInput({...bwsInput, targetPpm: parseFloat(e.target.value)})} className={inputClassName} placeholder="Target" />
                      </div>
                      <div className="pt-2">
                          <Button type="submit" className="w-full justify-center bg-orange-600 hover:bg-orange-700">更新 BWS 參數</Button>
                      </div>
                  </form>
              )}
          </Card>

          <Card 
              title="Excel 批次匯入" 
              className="border-l-4 border-l-slate-400 bg-slate-50"
          >
              <div className="space-y-6">
                  <div className="bg-white p-4 rounded-lg border border-slate-200 text-sm text-slate-600 space-y-2">
                      <h4 className="font-bold text-slate-800">格式說明 ({activeType})</h4>
                      
                      {activeType === 'A' && (
                          <ul className="list-disc list-inside">
                              <li>必要欄位: <strong>儲槽名稱</strong></li>
                              <li>日期欄位: <strong>1/1, 1/2...</strong> (對應液位高度)</li>
                          </ul>
                      )}
                      
                      {activeType === 'B' && (
                          <ul className="list-disc list-inside">
                              <li>欄位: <strong>生效日期, 供應商, 適用儲槽, 比重</strong></li>
                          </ul>
                      )}

                      {activeType === 'C' && (
                          <ul className="list-disc list-inside">
                              <li>必要欄位: <strong>儲槽名稱</strong></li>
                              <li>參數欄位: <strong>循環水量, 溫差...</strong></li>
                          </ul>
                      )}

                      {activeType === 'D' && (
                          <ul className="list-disc list-inside">
                              <li>必要欄位: <strong>儲槽名稱</strong></li>
                              <li>參數欄位: <strong>蒸氣量, 目標濃度</strong></li>
                          </ul>
                      )}
                  </div>

                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">選擇檔案 (.xlsx / .csv)</label>
                      <input 
                          type="file" 
                          accept=".csv, .xlsx, .xls"
                          onChange={e => setFile(e.target.files ? e.target.files[0] : null)}
                          className={`block w-full text-sm text-slate-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-full file:border-0
                          file:text-sm file:font-semibold
                          file:bg-slate-200 file:text-slate-700
                          hover:file:bg-slate-300
                          cursor-pointer ${inputClassName} pl-1`}
                      />
                  </div>

                  <Button onClick={processExcel} disabled={!file} className="w-full justify-center" variant="secondary">
                      <Icons.ClipboardPen className="w-4 h-4 mr-2" />
                      開始匯入 (Type {activeType})
                  </Button>
              </div>
          </Card>
      </div>

      <div className="flex justify-end pt-4 border-t border-slate-200">
         <Button onClick={handleExport} variant="ghost" className="text-slate-500">
             <Icons.Download className="w-4 h-4 mr-2" />
             匯出歷史液位資料 (Table A)
         </Button>
      </div>
    </div>
  );
};

// Renamed from ContractsView to DataBrowsingView
const DataBrowsingView: React.FC<{ tanks: Tank[], readings: Reading[] }> = ({ tanks, readings }) => {
  const [activeTab, setActiveTab] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [supplies, setSupplies] = useState<ChemicalSupply[]>([]);
  const [cwsParams, setCwsParams] = useState<CWSParameterRecord[]>([]);
  const [bwsParams, setBwsParams] = useState<BWSParameterRecord[]>([]);
  
  useEffect(() => {
    setSupplies(StorageService.getSupplies());
    setCwsParams(StorageService.getCWSParams());
    setBwsParams(StorageService.getBWSParams());
  }, []);

  const handleDeleteSupply = (id: string) => {
    if(confirm('確定要刪除此合約紀錄嗎？')) {
      StorageService.deleteSupply(id);
      setSupplies(StorageService.getSupplies());
    }
  };

  // Helper for rendering Table Head
  const Th: React.FC<{children: React.ReactNode, className?: string}> = ({children, className}) => (
      <th className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 ${className}`}>{children}</th>
  );
  
  // Helper for rendering Table Cell
  const Td: React.FC<{children: React.ReactNode, className?: string}> = ({children, className}) => (
      <td className={`px-4 py-3 text-sm text-slate-700 border-b border-slate-100 ${className}`}>{children}</td>
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation Tabs */}
      <div className="bg-white p-2 rounded-xl shadow-sm border border-slate-200 flex gap-2">
          <button onClick={() => setActiveTab('A')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'A' ? 'bg-blue-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>Table A: 液位紀錄</button>
          <button onClick={() => setActiveTab('B')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'B' ? 'bg-purple-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>Table B: 藥劑合約</button>
          <button onClick={() => setActiveTab('C')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'C' ? 'bg-sky-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>Table C: 冷卻水參數</button>
          <button onClick={() => setActiveTab('D')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'D' ? 'bg-orange-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>Table D: 鍋爐水參數</button>
      </div>

      <Card title={`數據瀏覽 - ${activeTab === 'A' ? '液位' : activeTab === 'B' ? '合約' : activeTab === 'C' ? 'CWS' : 'BWS'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            
            {/* Table A: Readings */}
            {activeTab === 'A' && (
                <>
                <thead>
                    <tr>
                        <Th>日期</Th>
                        <Th>儲槽名稱</Th>
                        <Th className="text-right">液位 (cm)</Th>
                        <Th className="text-right">存量 (L)</Th>
                        <Th className="text-right">重量 (kg)</Th>
                        <Th className="text-right">比重</Th>
                        <Th>操作人員</Th>
                    </tr>
                </thead>
                <tbody>
                    {readings.map(r => {
                        const t = tanks.find(tank => tank.id === r.tankId);
                        return (
                            <tr key={r.id} className="hover:bg-slate-50">
                                <Td>{new Date(r.timestamp).toLocaleDateString()}</Td>
                                <Td className="font-medium text-slate-800">{t?.name || r.tankId}</Td>
                                <Td className="text-right font-mono">{r.levelCm}</Td>
                                <Td className="text-right font-mono">{r.calculatedVolume.toFixed(1)}</Td>
                                <Td className="text-right font-mono">{r.calculatedWeightKg.toFixed(1)}</Td>
                                <Td className="text-right">{r.appliedSpecificGravity}</Td>
                                <Td className="text-slate-500">{r.operatorName}</Td>
                            </tr>
                        );
                    })}
                </tbody>
                </>
            )}

            {/* Table B: Supplies (Contracts) */}
            {activeTab === 'B' && (
                <>
                <thead>
                    <tr>
                        <Th>生效日期</Th>
                        <Th>供應商</Th>
                        <Th>適用儲槽</Th>
                        <Th>藥劑名稱</Th>
                        <Th className="text-right">比重</Th>
                        <Th className="text-right">單價</Th>
                        <Th>備註</Th>
                        <Th className="text-center">操作</Th>
                    </tr>
                </thead>
                <tbody>
                    {supplies.map(s => {
                        const tank = tanks.find(t => t.id === s.tankId);
                        return (
                            <tr key={s.id} className="hover:bg-slate-50">
                                <Td>{new Date(s.startDate).toLocaleDateString()}</Td>
                                <Td className="font-medium text-slate-800">{s.supplierName}</Td>
                                <Td>{tank?.name || s.tankId}</Td>
                                <Td>{s.chemicalName}</Td>
                                <Td className="text-right">{s.specificGravity}</Td>
                                <Td className="text-right">{s.price || '-'}</Td>
                                <Td className="text-slate-500 max-w-xs truncate">{s.notes}</Td>
                                <Td className="text-center">
                                    <button onClick={() => handleDeleteSupply(s.id)} className="text-red-400 hover:text-red-600 p-1">
                                        <Icons.Delete className="w-4 h-4" />
                                    </button>
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
                </>
            )}

            {/* Table C: CWS Params */}
            {activeTab === 'C' && (
                <>
                <thead>
                    <tr>
                        <Th>儲槽名稱</Th>
                        <Th className="text-right">循環水量 (m³/h)</Th>
                        <Th className="text-right">溫差 ΔT</Th>
                        <Th className="text-right">硬度 (CWS/MK)</Th>
                        <Th className="text-right">目標濃度 (ppm)</Th>
                        <Th className="text-right">濃縮倍數</Th>
                    </tr>
                </thead>
                <tbody>
                    {cwsParams.map((p, idx) => {
                        const tank = tanks.find(t => t.id === p.tankId);
                        return (
                            <tr key={idx} className="hover:bg-slate-50">
                                <Td className="font-medium text-slate-800">{tank?.name || p.tankId}</Td>
                                <Td className="text-right font-mono">{p.circulationRate}</Td>
                                <Td className="text-right font-mono">{p.tempDiff}</Td>
                                <Td className="text-right font-mono">{p.cwsHardness} / {p.makeupHardness}</Td>
                                <Td className="text-right font-mono">{p.targetPpm}</Td>
                                <Td className="text-right font-mono text-slate-500">
                                    {(p.cwsHardness && p.makeupHardness) ? (p.cwsHardness/p.makeupHardness).toFixed(1) : '-'}
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
                </>
            )}

            {/* Table D: BWS Params */}
            {activeTab === 'D' && (
                <>
                <thead>
                    <tr>
                        <Th>儲槽名稱</Th>
                        <Th className="text-right">月平均蒸氣產量 (Ton)</Th>
                        <Th className="text-right">目標藥劑濃度 (ppm)</Th>
                    </tr>
                </thead>
                <tbody>
                    {bwsParams.map((p, idx) => {
                        const tank = tanks.find(t => t.id === p.tankId);
                        return (
                            <tr key={idx} className="hover:bg-slate-50">
                                <Td className="font-medium text-slate-800">{tank?.name || p.tankId}</Td>
                                <Td className="text-right font-mono">{p.steamProduction}</Td>
                                <Td className="text-right font-mono">{p.targetPpm}</Td>
                            </tr>
                        );
                    })}
                </tbody>
                </>
            )}

          </table>
          
          {/* Empty State */}
          {((activeTab === 'A' && readings.length === 0) || 
            (activeTab === 'B' && supplies.length === 0) ||
            (activeTab === 'C' && cwsParams.length === 0) ||
            (activeTab === 'D' && bwsParams.length === 0)) && (
              <div className="text-center py-10 text-slate-400">
                  尚無資料
              </div>
          )}

        </div>
      </Card>
    </div>
  );
};

const AnalysisView: React.FC<{ tanks: Tank[], readings: Reading[] }> = ({ tanks, readings }) => {
  const [selectedTankId, setSelectedTankId] = useState<string>(tanks[0]?.id || '');
  const [metric, setMetric] = useState<'KG' | 'L'>('KG'); 
  const [rangeOption, setRangeOption] = useState<number>(30); 
  
  const selectedTank = tanks.find(t => t.id === selectedTankId);

  // Time Range Options
  const timeRanges = [
      { label: '近 1 個月', value: 30 },
      { label: '近 3 個月', value: 90 },
      { label: '近 6 個月', value: 180 },
      { label: '近 1 年', value: 365 },
  ];

  // 1. Process readings into daily continuous data
  const dailyData = useMemo(() => {
     if (!selectedTank || readings.length < 2) return [];

     const tankReadings = readings
      .filter(r => r.tankId === selectedTankId)
      .sort((a, b) => a.timestamp - b.timestamp);
    
     if (tankReadings.length < 1) return [];

     const dailyMap = new Map<string, { date: Date, usage: number, refill: number, level: number }>();

     for (let i = 0; i < tankReadings.length - 1; i++) {
        const curr = tankReadings[i];
        const next = tankReadings[i+1];
        
        const diffMs = next.timestamp - curr.timestamp;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        
        if (diffDays <= 0) continue;

        let totalUsage = 0;
        let startLevel = 0;
        let endLevel = 0;

        if (metric === 'L') {
            startLevel = curr.calculatedVolume;
            endLevel = next.calculatedVolume;
            totalUsage = (startLevel + next.addedAmountLiters) - endLevel;
        } else {
            // Apply historic specific gravity
            const addedKg = next.addedAmountLiters * next.appliedSpecificGravity;
            startLevel = curr.calculatedWeightKg;
            endLevel = next.calculatedWeightKg;
            totalUsage = (startLevel + addedKg) - endLevel;
        }

        const dailyUsage = Math.max(0, totalUsage / diffDays);

        let iterDate = new Date(curr.timestamp);
        while (iterDate < new Date(next.timestamp)) {
            const dateKey = iterDate.toISOString().split('T')[0];
            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, { 
                    date: new Date(iterDate), 
                    usage: dailyUsage, 
                    refill: 0, 
                    level: metric === 'L' ? curr.calculatedVolume : curr.calculatedWeightKg
                });
            }
            iterDate.setDate(iterDate.getDate() + 1);
        }
     }

     return Array.from(dailyMap.values()).sort((a,b) => a.date.getTime() - b.date.getTime());
  }, [readings, selectedTankId, metric, selectedTank]);

  // 2. Weekly Aggregation
  const weeklyData = useMemo(() => {
     if (dailyData.length === 0) return [];
     const cutoffTime = Date.now() - (rangeOption * 24 * 60 * 60 * 1000);
     const filteredDaily = dailyData.filter(d => d.date.getTime() >= cutoffTime);

     const weeklyMap = new Map<string, { date: Date, dateStr: string, usage: number, avgLevel: number, count: number }>();

     filteredDaily.forEach(day => {
         const dayDate = new Date(day.date);
         const dayNum = dayDate.getDay(); // 0 is Sunday
         const diffToSun = dayDate.getDate() - dayNum; 
         const weekStart = new Date(dayDate);
         weekStart.setDate(diffToSun);
         weekStart.setHours(0,0,0,0);
         
         const key = weekStart.toISOString().split('T')[0];
         
         if (!weeklyMap.has(key)) {
             weeklyMap.set(key, { 
                 date: weekStart, 
                 dateStr: `${weekStart.getMonth()+1}/${weekStart.getDate()}`,
                 usage: 0, 
                 avgLevel: 0,
                 count: 0 
             });
         }
         
         const w = weeklyMap.get(key)!;
         w.usage += day.usage;
         w.avgLevel += day.level;
         w.count += 1;
     });

     return Array.from(weeklyMap.values()).map(w => ({
         ...w,
         level: w.avgLevel / (w.count || 1)
     })).sort((a,b) => a.date.getTime() - b.date.getTime());
  }, [dailyData, rangeOption]);

  // 3. Monthly Comparison Data (Actual vs Theoretical)
  const monthlyComparisonData = useMemo(() => {
      if (!selectedTank || dailyData.length === 0) return [];
      
      const cutoffTime = Date.now() - (365 * 24 * 60 * 60 * 1000); // Always look back 1 year for this chart
      const filteredDaily = dailyData.filter(d => d.date.getTime() >= cutoffTime);
      
      const monthlyMap = new Map<string, { date: Date, dateStr: string, actual: number, days: number }>();

      filteredDaily.forEach(day => {
          const mKey = `${day.date.getFullYear()}-${String(day.date.getMonth()+1).padStart(2, '0')}`;
          if (!monthlyMap.has(mKey)) {
              monthlyMap.set(mKey, {
                  date: new Date(day.date.getFullYear(), day.date.getMonth(), 1),
                  dateStr: `${day.date.getFullYear()}/${day.date.getMonth()+1}`,
                  actual: 0,
                  days: 0
              });
          }
          const m = monthlyMap.get(mKey)!;
          m.actual += day.usage;
          m.days++; 
      });

      const calcMethod = selectedTank.calculationMethod || 'NONE';

      return Array.from(monthlyMap.values()).map(m => {
          let theoreticalTotal = 0;
          
          if (calcMethod === 'CWS_BLOWDOWN' && selectedTank.cwsParams) {
              const { circulationRate, tempDiff, targetPpm, cwsHardness, makeupHardness } = selectedTank.cwsParams;
              
              let cycles = 1;
              if (cwsHardness && makeupHardness && makeupHardness > 0) {
                  cycles = cwsHardness / makeupHardness;
              }

              // Formula: E = R * dT * 1.8 / 1000 * 24 * Days
              const E = (circulationRate * tempDiff * 1.8 * 24 * m.days) / 1000;
              // B = E / (Cycles - 1)
              const B = cycles > 1 ? E / (cycles - 1) : 0;
              // Theoretical (kg) = B(m3) * ppm / 1000
              theoreticalTotal = (B * targetPpm) / 1000;
              
          } else if (calcMethod === 'BWS_STEAM' && selectedTank.bwsParams) {
              const { steamProduction, targetPpm } = selectedTank.bwsParams;
              // steamProduction is Monthly. Adjust for number of days in this specific month slice if data is partial
              const proportionalFactor = m.days / 30; // Approx
              theoreticalTotal = (steamProduction * targetPpm / 1000) * proportionalFactor;
          }

          // If metric is L, we need SG to convert theoretical KG back to L
          // Simplified: assuming SG=1.0 for theoretical display in Liters, or user should switch to KG
          // For accuracy, we usually compare KG in chemical engineering.
          if (metric === 'L' && theoreticalTotal > 0) {
             // Not converting back to L for theoretical currently as SG varies per batch. 
             // Suggest viewing in KG.
          }

          return {
              dateStr: m.dateStr,
              date: m.date,
              actual: m.actual, 
              theoretical: theoreticalTotal,
              deviation: theoreticalTotal > 0 ? ((m.actual - theoreticalTotal) / theoreticalTotal) * 100 : 0
          };
      }).sort((a,b) => a.date.getTime() - b.date.getTime());

  }, [dailyData, selectedTank, metric]);

  const hasCalculation = selectedTank && selectedTank.calculationMethod && selectedTank.calculationMethod !== 'NONE';

  // Theoretical Calculation Details Card
  const TheoreticalUsageCard: React.FC<{ tank: Tank }> = ({ tank }) => {
      if (tank.calculationMethod === 'CWS_BLOWDOWN' && tank.cwsParams) {
          const { circulationRate, tempDiff, cwsHardness, makeupHardness, targetPpm } = tank.cwsParams;
          const days = 7;
          // E = R * dT * 1.8 / 1000 * 24 * Days
          const E = (circulationRate * tempDiff * 1.8 * 24 * days) / 1000;
          let C = 1;
          let cFormula = `預設 1`;
          if (cwsHardness && makeupHardness && makeupHardness > 0) {
              C = cwsHardness / makeupHardness;
              cFormula = `${cwsHardness} / ${makeupHardness} = ${C.toFixed(2)}`;
          }
          const BW = C > 1 ? E / (C - 1) : 0;
          const theoryUsage = (BW * targetPpm) / 1000;

          return (
              <Card title="理論用量計算展示 (每週基礎)" className="mt-6 border-l-4 border-l-sky-500">
                  <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-left border-collapse">
                          <tbody>
                              <tr className="bg-slate-100 border-b border-white">
                                  <th className="p-2 font-medium text-slate-700 w-1/3">週蒸發水量 (E)</th>
                                  <td className="p-2 font-mono text-slate-600 bg-slate-50">
                                      = R x ΔT x 1.8/1000 x 24HR x {days}天
                                      <br/>
                                      = {circulationRate} x {tempDiff} x 1.8/1000 x 24 x {days}
                                  </td>
                                  <td className="p-2 font-bold text-sky-700 text-right w-24">
                                      {E.toFixed(1)} <span className="text-[10px] text-slate-400">m³</span>
                                  </td>
                              </tr>
                              <tr className="bg-slate-100 border-b border-white">
                                  <th className="p-2 font-medium text-slate-700">平均濃縮倍數 (C)</th>
                                  <td className="p-2 font-mono text-slate-600 bg-slate-50">
                                      = 冷卻水硬度 / 補水硬度
                                      <br/>
                                      = {cFormula}
                                  </td>
                                  <td className="p-2 font-bold text-sky-700 text-right">
                                      {C.toFixed(1)}
                                  </td>
                              </tr>
                              <tr className="bg-slate-100 border-b border-white">
                                  <th className="p-2 font-medium text-slate-700">週排放水量 (B.W)</th>
                                  <td className="p-2 font-mono text-slate-600 bg-slate-50">
                                      = E / (C - 1)
                                      <br/>
                                      = {E.toFixed(1)} / ({C.toFixed(2)} - 1)
                                  </td>
                                  <td className="p-2 font-bold text-sky-700 text-right">
                                      {BW.toFixed(1)} <span className="text-[10px] text-slate-400">m³</span>
                                  </td>
                              </tr>
                              <tr className="bg-yellow-50 border-t-2 border-slate-200">
                                  <th className="p-2 font-bold text-slate-800">藥品理論週用量</th>
                                  <td className="p-2 font-mono text-slate-700">
                                      = B.W x 目標濃度 ({targetPpm} ppm) / 1000
                                  </td>
                                  <td className="p-2 font-bold text-red-600 text-right text-lg">
                                      {theoryUsage.toFixed(1)} <span className="text-xs text-slate-500">kg</span>
                                  </td>
                              </tr>
                          </tbody>
                      </table>
                  </div>
              </Card>
          );
      } else if (tank.calculationMethod === 'BWS_STEAM' && tank.bwsParams) {
          const { steamProduction, targetPpm } = tank.bwsParams;
          const days = 7;
          const weeklySteam = (steamProduction / 30) * days;
          const theoryUsage = (weeklySteam * targetPpm) / 1000;

          return (
               <Card title="理論用量計算展示 (每週基礎)" className="mt-6 border-l-4 border-l-orange-500">
                  <div className="overflow-x-auto">
                      <table className="min-w-full text-sm text-left border-collapse">
                          <tbody>
                              <tr className="bg-slate-100 border-b border-white">
                                  <th className="p-2 font-medium text-slate-700 w-1/3">每週蒸氣總產量 (S)</th>
                                  <td className="p-2 font-mono text-slate-600 bg-slate-50">
                                      = 月平均蒸氣量 / 30 * {days}天
                                      <br/>
                                      = {steamProduction} / 30 * {days}
                                  </td>
                                  <td className="p-2 font-bold text-orange-700 text-right w-24">
                                      {weeklySteam.toFixed(1)} <span className="text-[10px] text-slate-400">ton</span>
                                  </td>
                              </tr>
                              <tr className="bg-orange-50 border-t-2 border-slate-200">
                                  <th className="p-2 font-bold text-slate-800">藥品理論週用量</th>
                                  <td className="p-2 font-mono text-slate-700">
                                      = S x 目標濃度 ({targetPpm} ppm) / 1000
                                  </td>
                                  <td className="p-2 font-bold text-red-600 text-right text-lg">
                                      {theoryUsage.toFixed(1)} <span className="text-xs text-slate-500">kg</span>
                                  </td>
                              </tr>
                          </tbody>
                      </table>
                  </div>
              </Card>
          );
      }
      return null;
  };

  if (!selectedTank) return <div>請先設定儲槽</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="w-full sm:w-auto flex gap-4">
           <select 
            value={selectedTankId} 
            onChange={e => setSelectedTankId(e.target.value)}
            className={`${inputClassName} w-48`}
          >
            {tanks.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <select
             value={rangeOption}
             onChange={e => setRangeOption(Number(e.target.value))}
             className={`${inputClassName} w-40`}
          >
              {timeRanges.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
              ))}
          </select>
        </div>
        <div className="flex gap-2">
            <div className="bg-white border rounded-lg p-1 flex">
                <button onClick={() => setMetric('KG')} className={`px-3 py-1 rounded text-sm ${metric === 'KG' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>KG</button>
                <button onClick={() => setMetric('L')} className={`px-3 py-1 rounded text-sm ${metric === 'L' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>L</button>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Trend Chart */}
        <Card title={`每週用量趨勢 (${metric}/Week)`} className="h-[400px]">
           {weeklyData.length > 0 ? (
           <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weeklyData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dateStr" tick={{fontSize: 12}} />
              <YAxis yAxisId="left" label={{ value: `用量 (${metric})`, angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip />
              <Legend verticalAlign="top" />
              <Bar yAxisId="left" dataKey="usage" barSize={20} fill="#f59e0b" name="實際用量" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="level" stroke="#0ea5e9" strokeWidth={2} dot={false} name="平均存量" />
            </ComposedChart>
          </ResponsiveContainer>
          ) : (
             <div className="h-full flex items-center justify-center text-slate-400">此時間範圍內無足夠數據</div>
          )}
        </Card>

        {/* Monthly Comparison Chart */}
        <Card 
            title={hasCalculation ? `月度用量 vs 理論值 (${metric})` : `月度用量趨勢 (${metric})`}
            className="h-[400px]"
        >
            {monthlyComparisonData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="dateStr" tick={{fontSize: 12}} />
                        <YAxis />
                        <Tooltip />
                        <Legend verticalAlign="top" />
                        
                        {/* Only show theoretical if calculation is active and metric is KG */}
                        {hasCalculation && metric === 'KG' && (
                            <Area type="monotone" dataKey="theoretical" fill="#e0f2fe" stroke="#0ea5e9" name="理論預估" />
                        )}
                        
                        <Bar dataKey="actual" barSize={20} fill="#3b82f6" name="實際用量" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                </ResponsiveContainer>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                    <p>尚無足夠數據</p>
                </div>
            )}
        </Card>
      </div>

      <TheoreticalUsageCard tank={selectedTank} />
    </div>
  );
};

const SettingsView: React.FC<{ tanks: Tank[], onRefresh: () => void }> = ({ tanks, onRefresh }) => {
  const [editingTank, setEditingTank] = useState<Tank | null>(null);

  const handleDelete = (id: string) => {
      if(confirm('確定要刪除此儲槽及其所有相關設定嗎? (液位紀錄將保留)')) {
          StorageService.deleteTank(id);
          onRefresh();
      }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTank) return;
    StorageService.saveTank(editingTank);
    onRefresh();
    setEditingTank(null);
    alert('儲槽設定已更新');
  };

  const updateTankField = (field: keyof Tank, value: any) => {
     if (!editingTank) return;
     setEditingTank({ ...editingTank, [field]: value });
  };

  const updateCWSParam = (field: keyof CWSParameterRecord, value: any) => {
      if (!editingTank) return;
      const currentParams = editingTank.cwsParams || {
          tankId: editingTank.id,
          circulationRate: 0,
          tempDiff: 0,
          concentrationCycles: 1,
          targetPpm: 0
      } as CWSParameterRecord;
      
      setEditingTank({
          ...editingTank,
          cwsParams: { ...currentParams, [field]: value }
      });
  };

  const updateBWSParam = (field: keyof BWSParameterRecord, value: any) => {
      if (!editingTank) return;
      const currentParams = editingTank.bwsParams || {
          tankId: editingTank.id,
          steamProduction: 0,
          targetPpm: 0
      } as BWSParameterRecord;

      setEditingTank({
          ...editingTank,
          bwsParams: { ...currentParams, [field]: value }
      });
  };

  if (editingTank) {
      return (
          <Card title={`編輯儲槽設定 - ${editingTank.name}`}>
              <form onSubmit={handleSave} className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">儲槽名稱</label>
                          <input type="text" value={editingTank.name} onChange={e => updateTankField('name', e.target.value)} className={inputClassName} required />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">所屬系統</label>
                          <select value={editingTank.system} onChange={e => updateTankField('system', e.target.value)} className={inputClassName}>
                              {Object.values(SystemType).map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">容量 (L)</label>
                          <input type="number" value={editingTank.capacityLiters} onChange={e => updateTankField('capacityLiters', Number(e.target.value))} className={inputClassName} />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">換算因子 (L/cm)</label>
                          <input type="number" step="0.1" value={editingTank.factor} onChange={e => updateTankField('factor', Number(e.target.value))} className={inputClassName} />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">安全低液位警戒 (%)</label>
                          <input type="number" value={editingTank.safeMinLevel} onChange={e => updateTankField('safeMinLevel', Number(e.target.value))} className={inputClassName} />
                      </div>
                      <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
                          <input type="text" value={editingTank.description || ''} onChange={e => updateTankField('description', e.target.value)} className={inputClassName} />
                      </div>
                  </div>

                  <hr className="border-slate-200" />

                  {/* Calculation Logic */}
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">理論用量計算模式</label>
                      <select 
                        value={editingTank.calculationMethod || 'NONE'} 
                        onChange={e => updateTankField('calculationMethod', e.target.value)} 
                        className={inputClassName}
                      >
                          <option value="NONE">不計算 (僅追蹤實際用量)</option>
                          <option value="CWS_BLOWDOWN">冷卻水 (基於排放量與濃縮倍數)</option>
                          <option value="BWS_STEAM">鍋爐水 (基於蒸氣產量)</option>
                      </select>
                  </div>

                  {/* CWS Params Form */}
                  {editingTank.calculationMethod === 'CWS_BLOWDOWN' && (
                      <div className="bg-sky-50 p-4 rounded-lg border border-sky-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <h4 className="md:col-span-2 font-bold text-sky-800 text-sm">冷卻水參數設定</h4>
                          <div>
                              <label className="block text-xs font-medium text-sky-700 mb-1">循環水量 R (m3/h)</label>
                              <input type="number" value={editingTank.cwsParams?.circulationRate || 0} onChange={e => updateCWSParam('circulationRate', Number(e.target.value))} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-sky-700 mb-1">溫差 ΔT (°C)</label>
                              <input type="number" step="0.1" value={editingTank.cwsParams?.tempDiff || 0} onChange={e => updateCWSParam('tempDiff', Number(e.target.value))} className={inputClassName} />
                          </div>
                           <div>
                              <label className="block text-xs font-medium text-sky-700 mb-1">冷卻水硬度 (ppm)</label>
                              <input type="number" value={editingTank.cwsParams?.cwsHardness || 0} onChange={e => updateCWSParam('cwsHardness', Number(e.target.value))} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-sky-700 mb-1">補水硬度 (ppm)</label>
                              <input type="number" value={editingTank.cwsParams?.makeupHardness || 0} onChange={e => updateCWSParam('makeupHardness', Number(e.target.value))} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-sky-700 mb-1">目標濃度 (ppm)</label>
                              <input type="number" value={editingTank.cwsParams?.targetPpm || 0} onChange={e => updateCWSParam('targetPpm', Number(e.target.value))} className={inputClassName} />
                          </div>
                      </div>
                  )}

                  {/* BWS Params Form */}
                  {editingTank.calculationMethod === 'BWS_STEAM' && (
                      <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <h4 className="md:col-span-2 font-bold text-orange-800 text-sm">鍋爐水參數設定</h4>
                          <div>
                              <label className="block text-xs font-medium text-orange-700 mb-1">月蒸氣產量 (Ton)</label>
                              <input type="number" value={editingTank.bwsParams?.steamProduction || 0} onChange={e => updateBWSParam('steamProduction', Number(e.target.value))} className={inputClassName} />
                          </div>
                          <div>
                              <label className="block text-xs font-medium text-orange-700 mb-1">目標濃度 (ppm)</label>
                              <input type="number" value={editingTank.bwsParams?.targetPpm || 0} onChange={e => updateBWSParam('targetPpm', Number(e.target.value))} className={inputClassName} />
                          </div>
                      </div>
                  )}
                  
                  <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="ghost" onClick={() => setEditingTank(null)}>取消</Button>
                      <Button type="submit">儲存變更</Button>
                  </div>
              </form>
          </Card>
      );
  }
  
  return (
    <Card title="系統設定 - 儲槽管理">
        <div className="space-y-4">
             {tanks.map(t => (
                 <div key={t.id} className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-100">
                     <div className="flex-1">
                         <div className="font-bold text-slate-800">{t.name}</div>
                         <div className="text-xs text-slate-500">
                             {t.system} | Cap: {t.capacityLiters}L | Factor: {t.factor} L/cm
                             {t.calculationMethod && t.calculationMethod !== 'NONE' && (
                                 <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">
                                     {t.calculationMethod === 'CWS_BLOWDOWN' ? '自動計算: CWS' : '自動計算: BWS'}
                                 </span>
                             )}
                         </div>
                     </div>
                     <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setEditingTank(t)} className="py-1 px-3 text-xs">
                             <Icons.Settings className="w-4 h-4 mr-1" /> 編輯
                        </Button>
                        <Button variant="danger" onClick={() => handleDelete(t.id)} className="py-1 px-3 text-xs">
                             <Icons.Delete className="w-4 h-4" />
                        </Button>
                     </div>
                 </div>
             ))}
        </div>
    </Card>
  )
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState('dashboard');
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const refreshData = () => {
    setTanks(StorageService.getTanks());
    setReadings(StorageService.getReadings());
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleSaveReading = (reading: Reading) => {
    StorageService.addReading(reading);
    refreshData();
  };
  
  const handleBatchSaveReadings = (newReadings: Reading[]) => {
      StorageService.addReadingsBatch(newReadings);
      refreshData();
  }

  const renderContent = () => {
    switch(currentView) {
      case 'dashboard': return <DashboardView tanks={tanks} readings={readings} />;
      case 'entry': return <DataEntryView tanks={tanks} readings={readings} onSave={handleSaveReading} onBatchSave={handleBatchSaveReadings} onUpdateTank={() => refreshData()} />;
      case 'browsing': return <DataBrowsingView tanks={tanks} readings={readings} />;
      case 'analysis': return <AnalysisView tanks={tanks} readings={readings} />;
      case 'settings': return <SettingsView tanks={tanks} onRefresh={refreshData} />;
      default: return <DashboardView tanks={tanks} readings={readings} />;
    }
  };

  const NavItem = ({ id, icon: Icon, label }: any) => (
      <button 
          onClick={() => setCurrentView(id)}
          className={`w-full flex items-center px-4 py-3 text-sm font-medium transition-colors
          ${currentView === id ? 'bg-brand-50 text-brand-700 border-r-4 border-brand-500' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
      >
          <Icon className={`w-5 h-5 mr-3 ${currentView === id ? 'text-brand-500' : 'text-slate-400'}`} />
          {label}
      </button>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
        {/* Sidebar */}
        <aside className={`bg-white border-r border-slate-200 flex-shrink-0 transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-20'} flex flex-col`}>
            <div className="h-16 flex items-center px-6 border-b border-slate-100">
                <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center mr-3 shadow-sm">
                    <Icons.Droplet className="text-white w-5 h-5" />
                </div>
                {isSidebarOpen && <span className="font-bold text-xl text-slate-800 tracking-tight">PowerChem</span>}
            </div>

            <nav className="flex-1 overflow-y-auto py-6 space-y-1">
                 <NavItem id="dashboard" icon={Icons.Dashboard} label={isSidebarOpen ? "總覽看板" : ""} />
                 <NavItem id="entry" icon={Icons.Entry} label={isSidebarOpen ? "數據輸入" : ""} />
                 <NavItem id="browsing" icon={Icons.ClipboardPen} label={isSidebarOpen ? "數據瀏覽" : ""} />
                 <NavItem id="analysis" icon={Icons.Analysis} label={isSidebarOpen ? "用量分析" : ""} />
                 <NavItem id="settings" icon={Icons.Settings} label={isSidebarOpen ? "系統設定" : ""} />
            </nav>

            <div className="p-4 border-t border-slate-100">
                <button 
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="flex items-center justify-center w-full p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                >
                    {isSidebarOpen ? '收合選單' : <Icons.Settings className="w-5 h-5" />}
                </button>
            </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
             <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
                  <h1 className="text-xl font-bold text-slate-800">
                      {currentView === 'dashboard' && '總覽看板'}
                      {currentView === 'entry' && '數據輸入'}
                      {currentView === 'browsing' && '數據瀏覽'}
                      {currentView === 'analysis' && '用量趨勢分析'}
                      {currentView === 'settings' && '系統設定'}
                  </h1>
                  <div className="flex items-center gap-4">
                      <div className="text-sm text-slate-500">
                          {new Date().toLocaleDateString()}
                      </div>
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                          OP
                      </div>
                  </div>
             </header>
             <div className="flex-1 overflow-auto p-8">
                 {renderContent()}
             </div>
        </main>
    </div>
  );
};

export default App;