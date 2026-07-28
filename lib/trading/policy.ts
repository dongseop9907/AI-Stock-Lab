export interface RiskPolicy {
  /** 한 번의 거래에서 감수할 최대 계좌 손실 비율 */
  maxRiskPerTradeRate: number;

  /** 한 종목에 투자할 수 있는 최대 계좌 비율 */
  maxPositionRate: number;

  /** 전체 계좌에서 주식에 투자할 수 있는 최대 비율 */
  maxPortfolioExposureRate: number;

  /** 동일 업종에 투자할 수 있는 최대 계좌 비율 */
  maxSectorExposureRate: number;

  /** 동시에 보유할 수 있는 최대 종목 수 */
  maxOpenPositions: number;

  /** 최초 손절가의 최소 거리 */
  minStopDistanceRate: number;

  /** 최초 손절가의 최대 거리 */
  maxStopDistanceRate: number;

  /** 하루 최대 허용 손실 */
  maxDailyLossRate: number;
}

/*
 * 초기 개발용 보수적 기본값이다.
 * 향후 백테스트 결과를 바탕으로 버전별 정책으로 관리한다.
 */
export const DEFAULT_RISK_POLICY: Readonly<RiskPolicy> = Object.freeze({
  maxRiskPerTradeRate: 0.005,
  maxPositionRate: 0.1,
  maxPortfolioExposureRate: 0.6,
  maxSectorExposureRate: 0.25,
  maxOpenPositions: 8,
  minStopDistanceRate: 0.01,
  maxStopDistanceRate: 0.05,
  maxDailyLossRate: 0.02,
});