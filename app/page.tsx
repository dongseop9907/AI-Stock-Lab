import { demoPredictions } from "@/lib/demo-data";

function directionLabel(direction: string) {
  if (direction === "UP") return "상승";
  if (direction === "DOWN") return "하락";
  return "중립";
}

export default function Home() {
  const upCount = demoPredictions.filter((item) => item.direction === "UP").length;
  const avgConfidence = demoPredictions.reduce((sum, item) => sum + item.probability, 0) / demoPredictions.length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">A</span>
          <div>
            <strong>AI Stock Lab</strong>
            <small>자기평가형 투자 연구</small>
          </div>
        </div>
        <nav>
          <a className="active" href="#overview">대시보드</a>
          <a href="#predictions">오늘의 예측</a>
          <a href="#memory">경험 기억</a>
          <a href="#postmortem">성공·실패 복기</a>
          <a href="#trading">모의·실거래</a>
        </nav>
        <div className="sidebarNote">
          <span>현재 모드</span>
          <strong>연구·가상투자</strong>
          <p>실계좌 주문은 비활성화되어 있습니다.</p>
        </div>
      </aside>

      <section className="content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">2026-07-22 시장 분석</p>
            <h1>AI가 예측하고, 결과를 복기합니다.</h1>
            <p className="subcopy">모든 판단을 결과가 나오기 전에 저장하고 시장·업종 대비 성과로 평가합니다.</p>
          </div>
          <button className="primaryButton">오늘 분석 실행</button>
        </header>

        <div className="metricGrid">
          <article className="metricCard"><span>분석 종목</span><strong>2,487</strong><small>전체 국내 상장종목 목표</small></article>
          <article className="metricCard"><span>상승 후보</span><strong>{upCount}</strong><small>현재 데모 데이터 기준</small></article>
          <article className="metricCard"><span>평균 확신도</span><strong>{Math.round(avgConfidence * 100)}%</strong><small>확률 보정 전 데모</small></article>
          <article className="metricCard"><span>누적 경험</span><strong>0</strong><small>DB 연결 후 자동 누적</small></article>
        </div>

        <section className="panel" id="predictions">
          <div className="panelHeader">
            <div><p className="eyebrow">PRE-MARKET PREDICTIONS</p><h2>오늘의 예측 후보</h2></div>
            <span className="statusPill">Demo data</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead><tr><th>종목</th><th>방향</th><th>확률</th><th>기간</th><th>예상 초과수익</th><th>시장 국면</th></tr></thead>
              <tbody>
                {demoPredictions.map((item) => (
                  <tr key={item.stockCode}>
                    <td><strong>{item.stockName}</strong><small>{item.stockCode}</small></td>
                    <td><span className={`direction ${item.direction.toLowerCase()}`}>{directionLabel(item.direction)}</span></td>
                    <td>{Math.round(item.probability * 100)}%</td>
                    <td>{item.horizonDays}일</td>
                    <td className={item.expectedExcessReturn >= 0 ? "positive" : "negative"}>{(item.expectedExcessReturn * 100).toFixed(1)}%</td>
                    <td>{item.marketRegime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="twoColumn">
          <section className="panel" id="memory">
            <div className="panelHeader"><div><p className="eyebrow">MEMORY</p><h2>유사 경험 검색</h2></div></div>
            <div className="emptyState">
              <div className="orb" />
              <h3>과거 사례가 아직 없습니다.</h3>
              <p>예측과 결과가 쌓이면 pgvector로 비슷한 성공·실패 사례를 검색합니다.</p>
            </div>
          </section>

          <section className="panel" id="postmortem">
            <div className="panelHeader"><div><p className="eyebrow">POSTMORTEM</p><h2>복기 파이프라인</h2></div></div>
            <ol className="steps">
              <li><span>1</span><div><strong>사전 가설 고정</strong><p>예상 방향·기간·근거·위험을 결과 전에 저장</p></div></li>
              <li><span>2</span><div><strong>실제 결과 측정</strong><p>1·5·20·60일 수익과 시장 대비 성과 계산</p></div></li>
              <li><span>3</span><div><strong>원인 가설 생성</strong><p>맞은 근거, 놓친 변수, 우연 가능성을 분리</p></div></li>
              <li><span>4</span><div><strong>다음 판단에 반영</strong><p>반복 검증된 패턴만 모델과 전략에 적용</p></div></li>
            </ol>
          </section>
        </div>

        <section className="panel architecture" id="trading">
          <div className="panelHeader"><div><p className="eyebrow">ARCHITECTURE</p><h2>확장 가능한 시스템 구조</h2></div></div>
          <div className="flow">
            <div><strong>OpenDART·시세</strong><span>공시·재무·가격</span></div><i>→</i>
            <div><strong>LLM 분석</strong><span>가설·근거·위험</span></div><i>→</i>
            <div><strong>Supabase</strong><span>판단·결과·기억</span></div><i>→</i>
            <div><strong>평가 모델</strong><span>초과수익·오류 분석</span></div><i>→</i>
            <div><strong>KIS API</strong><span>모의 후 극소액 주문</span></div>
          </div>
        </section>
      </section>
    </main>
  );
}
