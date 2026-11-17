// 由離線補藥週期建模產生；日常輸入不得重算或覆寫。
export const PI_CYCLE_MODELS = {
  "tb_2": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 9,
    "manualEventCount": 11,
    "cycles": [
      {
        "start": "2025-11-03",
        "end": "2026-01-15",
        "manualStart": "2025-11-05",
        "manualEnd": "2026-01-17",
        "shiftDays": -1,
        "n": 58,
        "slope": 1.030846518988826,
        "intercept": 4.495069131100138,
        "medianErrorCm": 0.18434464770034253,
        "role": "TRAIN"
      },
      {
        "start": "2026-01-15",
        "end": "2026-04-09",
        "manualStart": "2026-01-17",
        "manualEnd": "2026-04-10",
        "shiftDays": 0,
        "n": 69,
        "slope": 1.0899575787812283,
        "intercept": 1.7248546932521265,
        "medianErrorCm": 0.2650096602251537,
        "role": "TRAIN"
      },
      {
        "start": "2026-04-09",
        "end": "2026-05-14",
        "manualStart": "2026-04-10",
        "manualEnd": "2026-05-15",
        "shiftDays": 0,
        "n": 32,
        "slope": 1.0050957842290982,
        "intercept": 3.8774476956291686,
        "medianErrorCm": 0.289390415346066,
        "role": "TRAIN"
      },
      {
        "start": "2026-05-14",
        "end": "2026-07-03",
        "manualStart": "2026-05-15",
        "manualEnd": "2026-07-04",
        "shiftDays": 0,
        "n": 47,
        "slope": 1.0413198047014014,
        "intercept": 2.600213996980351,
        "medianErrorCm": 0.23463560788110271,
        "role": "VALIDATION"
      },
      {
        "start": "2026-07-03",
        "end": "2026-09-01",
        "manualStart": "2026-07-04",
        "manualEnd": "2026-09-02",
        "shiftDays": 0,
        "n": 57,
        "slope": 1.0411766306924422,
        "intercept": 2.5810320704847953,
        "medianErrorCm": 0.22666937988745417,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-08-06",
        "end": "2025-11-03",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [
      {
        "start": "2025-05-29",
        "end": "2025-06-23",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-06-23",
        "end": "2025-08-06",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      }
    ],
    "excludedTimeRanges": [],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 1.030846518988826,
    "intercept": 4.495069131100138,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 159,
    "validationPointCount": 104,
    "validationMedianErrorCm": 1.3903700044813139,
    "validationP90ErrorCm": 1.7922758815370443,
    "slopeDrift": 0.05734225095932355,
    "levelSpan": 56.39999999999999,
    "rawRange": {
      "min": 16.3829288,
      "max": 87.05988
    },
    "periodStart": "2025-11-03",
    "periodEnd": "2026-09-01",
    "validationGrade": "VERIFIED",
    "name": "中和胺",
    "tag": "W52_LI-CF1T3A-Z.PV",
    "unit": "CM",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-d750078b-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "d750078bf6124244ec90bcffafb7ea20d04571e748fbdefe3208c0fcdfbeca79",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tb_1": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 9,
    "manualEventCount": 7,
    "cycles": [
      {
        "start": "2026-02-12",
        "end": "2026-05-05",
        "manualStart": "2026-02-14",
        "manualEnd": "2026-05-06",
        "shiftDays": 0,
        "n": 69,
        "slope": 0.9825002809007561,
        "intercept": -0.669353551740727,
        "medianErrorCm": 0.2586104824582378,
        "role": "TRAIN"
      },
      {
        "start": "2026-05-05",
        "end": "2026-06-10",
        "manualStart": "2026-05-06",
        "manualEnd": "2026-06-11",
        "shiftDays": 0,
        "n": 33,
        "slope": 0.8928466145242199,
        "intercept": 2.3816585537183848,
        "medianErrorCm": 0.0896924337376177,
        "role": "TRAIN"
      },
      {
        "start": "2026-06-10",
        "end": "2026-09-01",
        "manualStart": "2026-06-11",
        "manualEnd": "2026-09-02",
        "shiftDays": 0,
        "n": 80,
        "slope": 0.9234242912954862,
        "intercept": 1.4551416351098823,
        "medianErrorCm": 0.18025835536984403,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-14",
        "end": "2025-04-29",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-04-29",
        "end": "2026-02-12",
        "reason": "PI 週期內資料中斷超過 3 小時"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 0.937673447712488,
    "intercept": 1.1823817705128903,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 2,
    "validationCycleCount": 1,
    "trainPointCount": 102,
    "validationPointCount": 80,
    "validationMedianErrorCm": 0.48855482496182745,
    "validationP90ErrorCm": 0.857290373090521,
    "slopeDrift": 0.04780644402123779,
    "levelSpan": 27,
    "rawRange": {
      "min": 30.6634388,
      "max": 57.30097
    },
    "periodStart": "2026-02-12",
    "periodEnd": "2026-09-01",
    "validationGrade": "VERIFIED",
    "name": "清罐劑",
    "tag": "W52_LI-CF1T1A-Z.PV",
    "unit": "CM",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-e61dd36b-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "e61dd36befc3083ac26e8868b84b5fdb1e9b9417205296b9e1326c154b0538f0",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tb_3": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準",
    "piEventCount": 5,
    "manualEventCount": 5,
    "cycles": [
      {
        "start": "2026-04-09",
        "end": "2026-06-10",
        "manualStart": "2026-04-10",
        "manualEnd": "2026-06-11",
        "shiftDays": 0,
        "n": 59,
        "slope": 0.9837524167871217,
        "intercept": 3.314092518062232,
        "medianErrorCm": 0.1532077930560689,
        "role": "TRAIN"
      },
      {
        "start": "2026-06-10",
        "end": "2026-08-04",
        "manualStart": "2026-06-11",
        "manualEnd": "2026-08-05",
        "shiftDays": 0,
        "n": 52,
        "slope": 0.9831130269534256,
        "intercept": 3.395039099151475,
        "medianErrorCm": 0.14554415358304418,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-10-15",
        "end": "2026-01-05",
        "reason": "PI 週期內資料中斷超過 3 小時"
      },
      {
        "start": "2026-01-05",
        "end": "2026-04-09",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 0.9837524167871217,
    "intercept": 3.314092518062232,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 1,
    "validationCycleCount": 1,
    "trainPointCount": 59,
    "validationPointCount": 52,
    "validationMedianErrorCm": 0.1169334239959241,
    "validationP90ErrorCm": 0.29512507111649455,
    "slopeDrift": 0.000649949949586115,
    "levelSpan": 37.8,
    "rawRange": {
      "min": 19.9861546,
      "max": 65.40918
    },
    "periodStart": "2026-04-09",
    "periodEnd": "2026-08-04",
    "validationGrade": "LIMITED",
    "name": "脫氧劑",
    "tag": "W52_LI-CF1T2A-Z.PV",
    "unit": "CM",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-56912036-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "56912036180d02547ee46a5ce64808f9fc57869ca1db9a1bb5d085e43fe817f4",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc1_1": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 19,
    "manualEventCount": 20,
    "cycles": [
      {
        "start": "2026-06-16",
        "end": "2026-07-06",
        "manualStart": "2026-06-17",
        "manualEnd": "2026-07-07",
        "shiftDays": 0,
        "n": 17,
        "slope": 4.85255982235749,
        "intercept": 16.99230869268156,
        "medianErrorCm": 0.2496418810851111,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-06",
        "end": "2026-07-23",
        "manualStart": "2026-07-07",
        "manualEnd": "2026-07-24",
        "shiftDays": 0,
        "n": 14,
        "slope": 4.713282514546697,
        "intercept": 19.80779495754703,
        "medianErrorCm": 0.48850286377736296,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-23",
        "end": "2026-08-13",
        "manualStart": "2026-07-24",
        "manualEnd": "2026-08-14",
        "shiftDays": 0,
        "n": 18,
        "slope": 4.533220389863809,
        "intercept": 23.708492262704027,
        "medianErrorCm": 0.5672445461421773,
        "role": "TRAIN"
      },
      {
        "start": "2026-08-13",
        "end": "2026-09-08",
        "manualStart": "2026-08-14",
        "manualEnd": "2026-09-09",
        "shiftDays": 0,
        "n": 23,
        "slope": 4.814171689024538,
        "intercept": 18.12932091165773,
        "medianErrorCm": 0.5853566120144933,
        "role": "VALIDATION"
      },
      {
        "start": "2026-09-08",
        "end": "2026-09-29",
        "manualStart": "2026-09-09",
        "manualEnd": "2026-09-30",
        "shiftDays": 0,
        "n": 18,
        "slope": 4.809074011243373,
        "intercept": 18.121837367981705,
        "medianErrorCm": 0.7355860398023353,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-08-26",
        "end": "2025-09-11",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-11-27",
        "end": "2025-12-16",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [
      {
        "start": "2025-09-11",
        "end": "2025-10-07",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-10-07",
        "end": "2025-10-20",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-10-20",
        "end": "2025-11-11",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-11-11",
        "end": "2025-11-27",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-12-16",
        "end": "2026-01-08",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-01-08",
        "end": "2026-02-24",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-02-24",
        "end": "2026-04-02",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-04-02",
        "end": "2026-05-08",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-08",
        "end": "2026-05-27",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-27",
        "end": "2026-06-16",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      }
    ],
    "excludedTimeRanges": [],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 4.713282514546697,
    "intercept": 19.914872618957645,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 49,
    "validationPointCount": 41,
    "validationMedianErrorCm": 0.7115002391336134,
    "validationP90ErrorCm": 1.3833869098266547,
    "slopeDrift": 0.038203125767903634,
    "levelSpan": 29,
    "rawRange": {
      "min": 16.50711,
      "max": 23.9633141
    },
    "periodStart": "2026-06-16",
    "periodEnd": "2026-09-29",
    "validationGrade": "VERIFIED",
    "name": "CT-1 硫酸",
    "tag": "W52_LI-H2SO4-Z.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-070a9cab-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "070a9cab8251e404cac50966cf60537e8859d5b457e2a60a3d19f0757460972e",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60",
    "smoothingMinutes": 15
  },
  "tc1_2": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 20,
    "manualEventCount": 21,
    "cycles": [
      {
        "start": "2026-06-25",
        "end": "2026-07-14",
        "manualStart": "2026-06-26",
        "manualEnd": "2026-07-15",
        "shiftDays": 0,
        "n": 16,
        "slope": 3.3751469140169768,
        "intercept": 0.28892594664196025,
        "medianErrorCm": 0.4124670804166186,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-14",
        "end": "2026-07-29",
        "manualStart": "2026-07-15",
        "manualEnd": "2026-07-30",
        "shiftDays": 0,
        "n": 12,
        "slope": 3.449069355033914,
        "intercept": -0.9909282582742449,
        "medianErrorCm": 0.32427625708889707,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-29",
        "end": "2026-08-14",
        "manualStart": "2026-07-30",
        "manualEnd": "2026-08-15",
        "shiftDays": 0,
        "n": 13,
        "slope": 3.246005570726427,
        "intercept": 4.479122842576203,
        "medianErrorCm": 0.5007891487490923,
        "role": "TRAIN"
      },
      {
        "start": "2026-08-14",
        "end": "2026-08-26",
        "manualStart": "2026-08-15",
        "manualEnd": "2026-08-27",
        "shiftDays": 0,
        "n": 9,
        "slope": 3.35212838110712,
        "intercept": 1.6643096753193163,
        "medianErrorCm": 0.24239438175521855,
        "role": "VALIDATION"
      },
      {
        "start": "2026-08-26",
        "end": "2026-09-18",
        "manualStart": "2026-08-27",
        "manualEnd": "2026-09-19",
        "shiftDays": 0,
        "n": 20,
        "slope": 3.2703773769560627,
        "intercept": 3.8540272530227213,
        "medianErrorCm": 0.5192323022830578,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-05-09",
        "end": "2025-06-05",
        "reason": "PI 週期內資料中斷超過 3 小時"
      },
      {
        "start": "2025-09-05",
        "end": "2025-10-13",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [
      {
        "start": "2025-06-05",
        "end": "2025-06-20",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-06-20",
        "end": "2025-08-01",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-08-01",
        "end": "2025-08-15",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-08-15",
        "end": "2025-09-05",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-10-13",
        "end": "2025-11-26",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-11-26",
        "end": "2025-12-24",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-12-24",
        "end": "2026-02-05",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-02-05",
        "end": "2026-04-07",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-04-15",
        "end": "2026-05-14",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-14",
        "end": "2026-06-10",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-06-10",
        "end": "2026-06-25",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      }
    ],
    "excludedTimeRanges": [
      {
        "start": 1747216800000,
        "lastRepeated": 1747288800000,
        "end": 1747292400000,
        "hours": 20,
        "recovered": true
      },
      {
        "start": 1755712800000,
        "lastRepeated": 1756256400000,
        "end": 1756260000000,
        "hours": 151,
        "recovered": true
      },
      {
        "start": 1759806000000,
        "lastRepeated": 1759885200000,
        "end": 1759892400000,
        "hours": 22,
        "recovered": true
      },
      {
        "start": 1790262000000,
        "lastRepeated": 1790640000000,
        "end": 1790643600000,
        "hours": 105,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 3.3751469140169768,
    "intercept": 0.5615386826939783,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 41,
    "validationPointCount": 29,
    "validationMedianErrorCm": 0.5966676607835666,
    "validationP90ErrorCm": 1.334741294968964,
    "slopeDrift": 0.03826243614884617,
    "levelSpan": 62,
    "rawRange": {
      "min": 17.02133,
      "max": 35.243042
    },
    "periodStart": "2026-06-25",
    "periodEnd": "2026-09-18",
    "validationGrade": "VERIFIED",
    "name": "CT-1 漂白水",
    "tag": "W52_PH1-3_1.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-7a31b9a5-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "7a31b9a58bb19cd74f5dadde0d43b3e6ff67844f00b0690f8a719eded01a0a5b",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc1_3": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準",
    "piEventCount": 5,
    "manualEventCount": 6,
    "cycles": [
      {
        "start": "2025-09-24",
        "end": "2026-01-15",
        "manualStart": "2025-09-26",
        "manualEnd": "2026-01-17",
        "shiftDays": -1,
        "n": 94,
        "slope": 4.203537646841131,
        "intercept": 22.87412519127144,
        "medianErrorCm": 1.112575824462958,
        "role": "TRAIN"
      },
      {
        "start": "2026-01-15",
        "end": "2026-08-04",
        "manualStart": "2026-01-17",
        "manualEnd": "2026-08-05",
        "shiftDays": 0,
        "n": 186,
        "slope": 4.471415599578064,
        "intercept": 18.675192383584253,
        "medianErrorCm": 0.43130084112709355,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-29",
        "end": "2025-09-19",
        "reason": "PI 週期內資料中斷超過 3 小時"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1747216800000,
        "lastRepeated": 1747288800000,
        "end": 1747292400000,
        "hours": 20,
        "recovered": true
      },
      {
        "start": 1755727200000,
        "lastRepeated": 1756256400000,
        "end": 1756260000000,
        "hours": 147,
        "recovered": true
      },
      {
        "start": 1790262000000,
        "lastRepeated": 1790640000000,
        "end": 1790643600000,
        "hours": 105,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 4.203537646841131,
    "intercept": 22.87412519127144,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 1,
    "validationCycleCount": 1,
    "trainPointCount": 94,
    "validationPointCount": 186,
    "validationMedianErrorCm": 2.760442049903901,
    "validationP90ErrorCm": 5.260029619807689,
    "slopeDrift": 0.06372678806343934,
    "levelSpan": 147,
    "rawRange": {
      "min": 12.7222881,
      "max": 33.03345
    },
    "periodStart": "2025-09-24",
    "periodEnd": "2026-08-04",
    "validationGrade": "LIMITED",
    "name": "CT-1 腐蝕結垢抑制劑",
    "tag": "W52_PH1-3_3.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-d7ae7f9e-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "d7ae7f9e96eef7384fd73dd5237e1b1a86a950fcf09a819784d1ec7a39ecadc6",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc1_4": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：僅一個完整週期，以前段建模、後段驗證；尚未跨週期驗證",
    "piEventCount": 4,
    "manualEventCount": 6,
    "cycles": [
      {
        "start": "2026-01-15",
        "end": "2026-08-04",
        "manualStart": "2026-01-17",
        "manualEnd": "2026-08-05",
        "shiftDays": 0,
        "n": 186,
        "slope": 2.663612574961049,
        "intercept": 6.554927525985509,
        "medianErrorCm": 0.4864178049614587,
        "role": "SPLIT"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-29",
        "end": "2025-09-09",
        "reason": "PI 週期內資料中斷超過 3 小時"
      },
      {
        "start": "2025-09-09",
        "end": "2026-01-15",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1747216800000,
        "lastRepeated": 1747288800000,
        "end": 1747292400000,
        "hours": 20,
        "recovered": true
      },
      {
        "start": 1755727200000,
        "lastRepeated": 1756256400000,
        "end": 1756260000000,
        "hours": 147,
        "recovered": true
      },
      {
        "start": 1759806000000,
        "lastRepeated": 1759885200000,
        "end": 1759892400000,
        "hours": 22,
        "recovered": true
      },
      {
        "start": 1790262000000,
        "lastRepeated": 1790640000000,
        "end": 1790643600000,
        "hours": 105,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "holdoutStart": "2026-05-29",
    "slope": 2.663046816718111,
    "intercept": 6.618628039113403,
    "validationMode": "WITHIN_CYCLE",
    "trainCycleCount": 0,
    "validationCycleCount": 0,
    "trainPointCount": 120,
    "validationPointCount": 66,
    "validationMedianErrorCm": 0.44121404043498735,
    "validationP90ErrorCm": 0.9657260104753647,
    "slopeDrift": 0.00021244772693673752,
    "levelSpan": 157.5,
    "rawRange": {
      "min": 42.01926,
      "max": 75.20756
    },
    "periodStart": "2026-01-15",
    "periodEnd": "2026-08-04",
    "validationGrade": "LIMITED",
    "name": "CT-1 分散劑",
    "tag": "W52_PH1-3_2.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-42b938a9-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "42b938a9ec227c361f2689389bcb6515147c55f6434c712da27b557eed5bfff7",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc1_5": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準",
    "piEventCount": 23,
    "manualEventCount": 12,
    "cycles": [
      {
        "start": "2025-06-27",
        "end": "2025-09-09",
        "manualStart": "2025-06-29",
        "manualEnd": "2025-09-11",
        "shiftDays": -1,
        "n": 45,
        "slope": 0.8446379024181012,
        "intercept": 13.752479563273525,
        "medianErrorCm": 0.6608367159217536,
        "role": "TRAIN"
      },
      {
        "start": "2026-01-15",
        "end": "2026-04-14",
        "manualStart": "2026-01-17",
        "manualEnd": "2026-04-15",
        "shiftDays": 0,
        "n": 74,
        "slope": 0.7835394755902005,
        "intercept": 12.54290690820067,
        "medianErrorCm": 0.9690886423082432,
        "role": "TRAIN"
      },
      {
        "start": "2026-04-14",
        "end": "2026-06-04",
        "manualStart": "2026-04-15",
        "manualEnd": "2026-06-06",
        "shiftDays": 0,
        "n": 48,
        "slope": 0.7775452378994386,
        "intercept": 14.789147904009795,
        "medianErrorCm": 0.8748108054248664,
        "role": "TRAIN"
      },
      {
        "start": "2026-06-04",
        "end": "2026-07-03",
        "manualStart": "2026-06-06",
        "manualEnd": "2026-07-04",
        "shiftDays": 0,
        "n": 25,
        "slope": 0.8336283962563802,
        "intercept": 11.606949359701261,
        "medianErrorCm": 0.7305730846510343,
        "role": "VALIDATION"
      },
      {
        "start": "2026-07-03",
        "end": "2026-09-01",
        "manualStart": "2026-07-04",
        "manualEnd": "2026-09-02",
        "shiftDays": 0,
        "n": 57,
        "slope": 0.8988489003913254,
        "intercept": 9.214144383671837,
        "medianErrorCm": 0.7935308870885933,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-29",
        "end": "2025-06-27",
        "reason": "PI 週期內資料中斷超過 3 小時"
      },
      {
        "start": "2025-09-09",
        "end": "2025-11-24",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-11-24",
        "end": "2026-01-07",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1747216800000,
        "lastRepeated": 1747288800000,
        "end": 1747292400000,
        "hours": 20,
        "recovered": true
      },
      {
        "start": 1755702000000,
        "lastRepeated": 1756256400000,
        "end": 1756260000000,
        "hours": 154,
        "recovered": true
      },
      {
        "start": 1790262000000,
        "lastRepeated": 1790640000000,
        "end": 1790643600000,
        "hours": 105,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 0.7835394755902005,
    "intercept": 14.434717041252142,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 167,
    "validationPointCount": 82,
    "validationMedianErrorCm": 2.072806079742893,
    "validationP90ErrorCm": 5.514106844476402,
    "slopeDrift": 0.14716479308750596,
    "levelSpan": 76,
    "rawRange": {
      "min": -2.43099,
      "max": 96.87523
    },
    "periodStart": "2025-06-27",
    "periodEnd": "2026-09-01",
    "validationGrade": "LIMITED",
    "name": "CT-1 銅腐蝕抑制劑",
    "tag": "W52_PH1-3_4.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-ee329a14-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "ee329a143f9780c4148bc4efd38ce4d8f201c6554ce86ba12198173211cecce5",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc2_1": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 24,
    "manualEventCount": 29,
    "cycles": [
      {
        "start": "2026-06-15",
        "end": "2026-07-07",
        "manualStart": "2026-06-16",
        "manualEnd": "2026-07-08",
        "shiftDays": 0,
        "n": 19,
        "slope": 1.990904606097724,
        "intercept": 0.22766719811569658,
        "medianErrorCm": 0.2640576434913555,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-07",
        "end": "2026-07-24",
        "manualStart": "2026-07-08",
        "manualEnd": "2026-07-25",
        "shiftDays": 0,
        "n": 14,
        "slope": 1.9973993008286723,
        "intercept": -0.3197478665801583,
        "medianErrorCm": 0.1454570608091501,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-24",
        "end": "2026-08-12",
        "manualStart": "2026-07-25",
        "manualEnd": "2026-08-13",
        "shiftDays": 0,
        "n": 16,
        "slope": 1.9969489477079592,
        "intercept": -0.32661901166117957,
        "medianErrorCm": 0.1447780048581606,
        "role": "TRAIN"
      },
      {
        "start": "2026-08-12",
        "end": "2026-09-07",
        "manualStart": "2026-08-13",
        "manualEnd": "2026-09-08",
        "shiftDays": 0,
        "n": 23,
        "slope": 1.9882542599835822,
        "intercept": 0.13616941651125103,
        "medianErrorCm": 0.12033411424124552,
        "role": "VALIDATION"
      },
      {
        "start": "2026-09-07",
        "end": "2026-09-30",
        "manualStart": "2026-09-08",
        "manualEnd": "2026-10-01",
        "shiftDays": 0,
        "n": 20,
        "slope": 1.9838605256017654,
        "intercept": 0.2985702457266797,
        "medianErrorCm": 0.1074654636579595,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-07-04",
        "end": "2025-08-01",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-08-18",
        "end": "2025-09-18",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-09-18",
        "end": "2025-10-29",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-10-29",
        "end": "2025-12-03",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-12-22",
        "end": "2026-01-07",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [
      {
        "start": "2025-04-14",
        "end": "2025-05-19",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-05-19",
        "end": "2025-06-09",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-06-09",
        "end": "2025-07-04",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-08-01",
        "end": "2025-08-18",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-12-03",
        "end": "2025-12-22",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-01-07",
        "end": "2026-02-02",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-02-02",
        "end": "2026-02-23",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-02-23",
        "end": "2026-03-13",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-03-13",
        "end": "2026-04-02",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-04-02",
        "end": "2026-04-17",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-04-17",
        "end": "2026-05-07",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-07",
        "end": "2026-05-26",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-26",
        "end": "2026-06-15",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      }
    ],
    "excludedTimeRanges": [],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 1.9969489477079592,
    "intercept": -0.302312347672526,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 49,
    "validationPointCount": 43,
    "validationMedianErrorCm": 0.13303390842924046,
    "validationP90ErrorCm": 0.3724193601113228,
    "slopeDrift": 0.006554209671316924,
    "levelSpan": 56.510000000000005,
    "rawRange": {
      "min": 25.20876,
      "max": 59.9162178
    },
    "periodStart": "2026-06-15",
    "periodEnd": "2026-09-30",
    "validationGrade": "VERIFIED",
    "name": "CT-2 硫酸",
    "tag": "W52_LI-CF24-Y.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-fd87c3b4-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "fd87c3b4762bab7cc9c4dd4cd722235679fee67c1a612469bf19de0bab2f1838",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc2_2": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準",
    "piEventCount": 20,
    "manualEventCount": 20,
    "cycles": [
      {
        "start": "2026-06-25",
        "end": "2026-07-12",
        "manualStart": "2026-06-26",
        "manualEnd": "2026-07-15",
        "shiftDays": -1,
        "n": 15,
        "slope": 2.2702683749082753,
        "intercept": 55.2883190020723,
        "medianErrorCm": 1.155542146934721,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-12",
        "end": "2026-07-29",
        "manualStart": "2026-07-15",
        "manualEnd": "2026-07-30",
        "shiftDays": -1,
        "n": 12,
        "slope": 2.2161078735827173,
        "intercept": 54.001060745541835,
        "medianErrorCm": 0.7351745145659763,
        "role": "TRAIN"
      },
      {
        "start": "2026-07-29",
        "end": "2026-08-14",
        "manualStart": "2026-07-30",
        "manualEnd": "2026-08-15",
        "shiftDays": 0,
        "n": 13,
        "slope": 2.2892745811626942,
        "intercept": 57.66361189511172,
        "medianErrorCm": 0.42860563394574314,
        "role": "TRAIN"
      },
      {
        "start": "2026-08-14",
        "end": "2026-08-26",
        "manualStart": "2026-08-15",
        "manualEnd": "2026-08-27",
        "shiftDays": 0,
        "n": 9,
        "slope": 2.3524413964876247,
        "intercept": 55.99925811457639,
        "medianErrorCm": 0.08282292233248256,
        "role": "VALIDATION"
      },
      {
        "start": "2026-08-26",
        "end": "2026-09-18",
        "manualStart": "2026-08-27",
        "manualEnd": "2026-09-19",
        "shiftDays": 0,
        "n": 20,
        "slope": 2.334390498495489,
        "intercept": 57.17609759319134,
        "medianErrorCm": 0.18757584911770664,
        "role": "VALIDATION"
      }
    ],
    "rejected": [],
    "excludedCycles": [
      {
        "start": "2025-05-09",
        "end": "2025-06-05",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-06-05",
        "end": "2025-06-20",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-06-20",
        "end": "2025-08-01",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-08-01",
        "end": "2025-08-15",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-08-15",
        "end": "2025-09-05",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-09-05",
        "end": "2025-10-13",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-10-13",
        "end": "2025-11-26",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-11-26",
        "end": "2025-12-24",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2025-12-24",
        "end": "2026-02-05",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-02-05",
        "end": "2026-04-06",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-04-15",
        "end": "2026-05-14",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-05-14",
        "end": "2026-06-10",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      },
      {
        "start": "2026-06-10",
        "end": "2026-06-25",
        "reason": "較舊週期或歷史比例區段，不參與本版公式"
      }
    ],
    "excludedTimeRanges": [
      {
        "start": 1776348000000,
        "lastRepeated": 1776646800000,
        "end": 1776650400000,
        "hours": 83,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 2.2702683749082753,
    "intercept": 55.2883190020723,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 40,
    "validationPointCount": 29,
    "validationMedianErrorCm": 3.4473572465010562,
    "validationP90ErrorCm": 4.072179244947826,
    "slopeDrift": 0.036195289723255586,
    "levelSpan": 77.5,
    "rawRange": {
      "min": 1.91158819,
      "max": 29.0770111
    },
    "periodStart": "2026-06-25",
    "periodEnd": "2026-09-18",
    "validationGrade": "LIMITED",
    "name": "CT-2 漂白水",
    "tag": "W52_PH2-2_1.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-55c3e3aa-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "55c3e3aa93a6a000cd558afc69f7e9f1aafea1acfabd7615967dad0fb9fa2f1e",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc2_3": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 6,
    "manualEventCount": 7,
    "cycles": [
      {
        "start": "2025-07-24",
        "end": "2025-08-06",
        "manualStart": "2025-07-26",
        "manualEnd": "2025-08-08",
        "shiftDays": -1,
        "n": 7,
        "slope": 1.9487024283564636,
        "intercept": 19.784734843629597,
        "medianErrorCm": 0.08292227676431096,
        "role": "TRAIN"
      },
      {
        "start": "2025-08-06",
        "end": "2025-11-03",
        "manualStart": "2025-08-08",
        "manualEnd": "2025-11-05",
        "shiftDays": -1,
        "n": 66,
        "slope": 1.91804597984731,
        "intercept": 20.144454324558797,
        "medianErrorCm": 0.2404372556973513,
        "role": "TRAIN"
      },
      {
        "start": "2025-11-03",
        "end": "2026-04-14",
        "manualStart": "2025-11-05",
        "manualEnd": "2026-04-15",
        "shiftDays": 0,
        "n": 134,
        "slope": 1.9089045597775478,
        "intercept": 19.87326060280439,
        "medianErrorCm": 0.2937204922320049,
        "role": "VALIDATION"
      },
      {
        "start": "2026-04-14",
        "end": "2026-06-04",
        "manualStart": "2026-04-15",
        "manualEnd": "2026-06-05",
        "shiftDays": 0,
        "n": 48,
        "slope": 1.891612980161571,
        "intercept": 20.216525514243358,
        "medianErrorCm": 0.17741058537559695,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-29",
        "end": "2025-07-24",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1755298800000,
        "lastRepeated": 1755565200000,
        "end": 1755568800000,
        "hours": 74,
        "recovered": true
      },
      {
        "start": 1788408000000,
        "lastRepeated": 1788746400000,
        "end": 1788750000000,
        "hours": 94,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 1.9333742041018867,
    "intercept": 19.773001200609816,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 2,
    "validationCycleCount": 2,
    "trainPointCount": 73,
    "validationPointCount": 182,
    "validationMedianErrorCm": 1.0304505711776848,
    "validationP90ErrorCm": 1.937204148221202,
    "slopeDrift": 0.021600176443708707,
    "levelSpan": 129.7,
    "rawRange": {
      "min": 6.30121851,
      "max": 85.88769
    },
    "periodStart": "2025-07-24",
    "periodEnd": "2026-06-04",
    "validationGrade": "VERIFIED",
    "name": "CT-2 腐蝕結垢抑制劑",
    "tag": "W52_PH2-3_3.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-1e69fa42-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "1e69fa42551136499d489947ecaa78648b313e2c46c7f73e1bfd077675a2b710",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc2_4": {
    "status": "ACTIVE",
    "reason": "有限驗證採用：已保留獨立週期驗證，但週期數或精度未達完整驗證標準",
    "piEventCount": 6,
    "manualEventCount": 8,
    "cycles": [
      {
        "start": "2025-11-24",
        "end": "2026-04-14",
        "manualStart": "2025-11-26",
        "manualEnd": "2026-04-15",
        "shiftDays": 0,
        "n": 115,
        "slope": 2.7054226106599364,
        "intercept": 11.913842776127623,
        "medianErrorCm": 0.3635867627799243,
        "role": "TRAIN"
      },
      {
        "start": "2026-04-14",
        "end": "2026-06-04",
        "manualStart": "2026-04-15",
        "manualEnd": "2026-06-05",
        "shiftDays": 0,
        "n": 48,
        "slope": 2.6773127485974433,
        "intercept": 11.531140278619894,
        "medianErrorCm": 0.1357891702046281,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2025-04-29",
        "end": "2025-07-25",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-07-25",
        "end": "2025-08-06",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2025-08-06",
        "end": "2025-11-24",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1755324000000,
        "lastRepeated": 1755565200000,
        "end": 1755568800000,
        "hours": 67,
        "recovered": true
      },
      {
        "start": 1759806000000,
        "lastRepeated": 1759885200000,
        "end": 1759892400000,
        "hours": 22,
        "recovered": true
      },
      {
        "start": 1788408000000,
        "lastRepeated": 1788746400000,
        "end": 1788750000000,
        "hours": 94,
        "recovered": true
      }
    ],
    "manualMinCm": 28,
    "excludedManualCount": 20,
    "slope": 2.7054226106599364,
    "intercept": 11.913842776127623,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 1,
    "validationCycleCount": 1,
    "trainPointCount": 115,
    "validationPointCount": 48,
    "validationMedianErrorCm": 1.0633784220348161,
    "validationP90ErrorCm": 1.4285175773349579,
    "slopeDrift": 0.010390192627109052,
    "levelSpan": 126.6,
    "rawRange": {
      "min": 6.5033865,
      "max": 63.6877823
    },
    "periodStart": "2025-11-24",
    "periodEnd": "2026-06-04",
    "validationGrade": "LIMITED",
    "name": "CT-2 分散劑",
    "tag": "W52_PH2-3_4.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-d4e02373-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "d4e0237304d8e9f610eb051f490f0d82fb8ec5bd05f2375d631e2ad80a36cb07",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  },
  "tc2_5": {
    "status": "ACTIVE",
    "reason": "近期完整補藥週期及獨立週期驗證通過",
    "piEventCount": 10,
    "manualEventCount": 7,
    "cycles": [
      {
        "start": "2025-04-29",
        "end": "2025-10-29",
        "manualStart": "2025-05-01",
        "manualEnd": "2025-11-01",
        "shiftDays": -1,
        "n": 135,
        "slope": 1.29754480317403,
        "intercept": 5.218631265049865,
        "medianErrorCm": 0.14680321483892556,
        "role": "TRAIN"
      },
      {
        "start": "2025-10-29",
        "end": "2026-02-12",
        "manualStart": "2025-11-01",
        "manualEnd": "2026-02-14",
        "shiftDays": -1,
        "n": 88,
        "slope": 1.253527990269177,
        "intercept": 7.821028374728144,
        "medianErrorCm": 0.12092015329206873,
        "role": "TRAIN"
      },
      {
        "start": "2026-02-12",
        "end": "2026-04-14",
        "manualStart": "2026-02-14",
        "manualEnd": "2026-04-15",
        "shiftDays": 0,
        "n": 48,
        "slope": 1.2699116113675506,
        "intercept": 6.235340478548743,
        "medianErrorCm": 0.09470575173460816,
        "role": "TRAIN"
      },
      {
        "start": "2026-04-14",
        "end": "2026-05-14",
        "manualStart": "2026-04-15",
        "manualEnd": "2026-05-15",
        "shiftDays": 0,
        "n": 27,
        "slope": 1.2427135970078251,
        "intercept": 6.7591821476340925,
        "medianErrorCm": 0.11365073077119092,
        "role": "VALIDATION"
      },
      {
        "start": "2026-05-14",
        "end": "2026-07-03",
        "manualStart": "2026-05-15",
        "manualEnd": "2026-07-04",
        "shiftDays": 0,
        "n": 47,
        "slope": 1.2909428975031692,
        "intercept": 4.423192595452605,
        "medianErrorCm": 0.11257215786166341,
        "role": "VALIDATION"
      }
    ],
    "rejected": [
      {
        "start": "2026-07-14",
        "end": "2026-07-28",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      },
      {
        "start": "2026-07-28",
        "end": "2026-09-10",
        "reason": "找不到兩端補藥時間及跨度相符的人工完整週期"
      }
    ],
    "excludedCycles": [],
    "excludedTimeRanges": [
      {
        "start": 1755324000000,
        "lastRepeated": 1755565200000,
        "end": 1755568800000,
        "hours": 67,
        "recovered": true
      },
      {
        "start": 1788408000000,
        "lastRepeated": 1788746400000,
        "end": 1788750000000,
        "hours": 94,
        "recovered": true
      }
    ],
    "manualMinCm": null,
    "excludedManualCount": 0,
    "slope": 1.2699116113675506,
    "intercept": 6.919403742475701,
    "validationMode": "CROSS_CYCLE",
    "trainCycleCount": 3,
    "validationCycleCount": 2,
    "trainPointCount": 271,
    "validationPointCount": 74,
    "validationMedianErrorCm": 1.6708624600634039,
    "validationP90ErrorCm": 2.031399455226939,
    "slopeDrift": 0.021759933178909563,
    "levelSpan": 94.89999999999999,
    "rawRange": {
      "min": 12.580658,
      "max": 100.364456
    },
    "periodStart": "2025-04-29",
    "periodEnd": "2026-07-03",
    "validationGrade": "VERIFIED",
    "name": "CT-2 銅腐蝕抑制劑",
    "tag": "W52_PH2-3_2.PV",
    "unit": "PERCENT",
    "createdAt": "2026-10-06T11:11:21+08:00",
    "dataPeriodStart": "2025-04-06",
    "dataPeriodEnd": "2026-10-06",
    "version": "cycle-v3-quality-18m-2026-10-06-40d18748-89e595a8-61e4c7ba",
    "algorithmHash": "40d187486c3bf579e8627f736afbdd1f0579f0952ac2d26703430f2d4a382f18",
    "sourceHash": "89e595a8f81433fd81c31efce0b35e27aceede5438c33eff8fa71f24ac35aaa5",
    "manualSourceHash": "61e4c7ba6b32efc78e614c4e17aa7f5df965c8a2b6d59acfe7f3ff4c7b544e60"
  }
};
