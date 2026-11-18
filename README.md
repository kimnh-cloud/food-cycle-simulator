# 잉여 농산물 순환 재배분 시뮬레이터

시뮬레이션 기반 잉여 농산물 순환 재배분 최적화 시스템 웹 프로토타입 (2026 동국대학교 공과대학 아이디어 경진대회)

- `index.html` 기본 시뮬레이터 (Stage 1 예측 → Stage 2 배분 → Stage 3 영양 매칭, 피드백 토글)
- `cycle.html` 순환 사이클 시뮬레이터 (시나리오별 다회 피드백)
  - 바로 열기 예시: `cycle.html?s=cabbage&run=3` (s = base · cabbage · onion · metro · combo · scaleup)

데이터: 통계청 농작물생산조사, 농림축산식품부 쌀 수급 발표, KOSIS 시도별 기초생활보장 수급자(2025), 국가표준식품성분DB, KDRIs 2020, aT 비규격품 비율
