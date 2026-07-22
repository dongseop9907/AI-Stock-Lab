import type { PredictionSummary } from "./types";

export const demoPredictions: PredictionSummary[] = [
  {
    stockCode: "005930",
    stockName: "삼성전자",
    direction: "UP",
    probability: 0.68,
    horizonDays: 20,
    expectedExcessReturn: 0.042,
    marketRegime: "반도체 회복·중간 변동성",
    reasons: ["영업이익 개선 기대", "외국인 수급 회복", "업종 대비 밸류에이션 부담 완화"],
    risks: ["메모리 가격 반전", "환율 급변"],
  },
  {
    stockCode: "000660",
    stockName: "SK하이닉스",
    direction: "NEUTRAL",
    probability: 0.54,
    horizonDays: 5,
    expectedExcessReturn: 0.008,
    marketRegime: "고변동성·호재 선반영",
    reasons: ["AI 메모리 수요 강세", "실적 추정치 상향"],
    risks: ["단기 급등", "차익실현 가능성"],
  },
  {
    stockCode: "035420",
    stockName: "NAVER",
    direction: "DOWN",
    probability: 0.61,
    horizonDays: 20,
    expectedExcessReturn: -0.027,
    marketRegime: "성장주 할인율 부담",
    reasons: ["광고 성장 둔화 우려", "금리 민감도 상승"],
    risks: ["AI 서비스 매출 조기 반영", "대규모 자사주 정책"],
  },
];
