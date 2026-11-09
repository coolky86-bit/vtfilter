# 빈티지톡 상품필터 (vtfilter)

빈티지톡 쇼핑몰 상품목록 [필터]가 빠르게 뜨도록, 분류별 상품 목록 파일을 미리 만들어 두는 저장소입니다.

- 1시간마다 GitHub Actions가 `build.mjs`를 실행합니다.
  - 쇼핑몰 공개 자료 파일(`vtf_data.html`): 이름·브랜드·가격·할인가·실측·품절·사진
  - 카페24 앱 "빈티지톡 상품필터"(읽기 전용 Front API, 앱 번호만 사용): 상품 검색어 태그, 분류 소속
- 결과는 GitHub Pages `https://coolky86-bit.github.io/vtfilter/c/<분류번호>.json` 에 올라갑니다.
- 상태 확인: `https://coolky86-bit.github.io/vtfilter/status.json`
- 비밀번호·비밀키는 저장소에 없습니다. 공개되는 것은 쇼핑몰에서 누구나 볼 수 있는 상품 정보뿐입니다.
