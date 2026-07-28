export interface TrailingStopPolicy {
  activationRate: number;
  trailingDistanceRate: number;
}

export const DEFAULT_TRAILING_STOP_POLICY:
  Readonly<TrailingStopPolicy> = Object.freeze({
    /*
     * 평균 매수가 대비 3% 이상 상승하면
     * 추적손절을 활성화한다.
     */
    activationRate: 0.03,

    /*
     * 기록된 최고가에서 2% 아래를
     * 추적손절가로 사용한다.
     */
    trailingDistanceRate: 0.02,
  });