// 엔딩 데이터. 새 엔딩은 여기에 항목만 추가하면 된다.
// - id: end_game 함수가 기록하는 rooms.ending 값과 같다.
// - cuts[].variants[end_reason]: 해당 종료 사유일 때 대체 컷(이미지/자막)
// - lines: 한 줄씩 타이핑되는 자막. 비어 있으면 그림만 보여준다.

export const ENDINGS = [
  {
    id: 'escape',
    title: '새벽의 탈주',
    winnerRole: 'prisoner',
    thumb: 'endA3',
    cuts: [
      {
        img: 'endA1',
        caption: '정문이 삐걱이며 열린다.',
        lines: ['드디어… 밖이다.'],
      },
      {
        img: 'endA2',
        caption: '언덕 위에서 뒤돌아본 감옥. 창문에 교도관의 실루엣.',
        lines: ['아직… 저 안에 누군가 서 있다.'],
        variants: {
          zombie: {
            img: 'endA2_alt',
            caption: '언덕 위에서 뒤돌아본 감옥. 창문엔 좀비의 그림자뿐.',
            lines: ['창문 너머엔… 더 이상 사람이 없다.'],
          },
        },
      },
      {
        img: 'endA3',
        caption: '언덕 너머로 해가 뜨고, 도시에서 연기가 피어오른다.',
        lines: ['그런데… 도시도 조용하다. 너무 조용하다.'],
      },
      {
        img: 'endA4',
        caption: '발밑에 떨어진 라디오에서 잡음 섞인 방송.',
        lines: ['…치지직… 생존자는…', '…가장 가까운 교도소로 대피하십시오…'],
      },
    ],
    final: 'THE END? — 감옥이 가장 안전한 곳이었다.',
  },
  {
    id: 'last_shift',
    title: '마지막 근무',
    winnerRole: 'guard',
    thumb: 'endB2',
    cuts: [
      {
        img: 'endB1',
        caption: '제한시간 종료와 함께 감옥 전체에 사이렌이 울린다.',
        lines: ['06:00. 교대 시간이다.'],
      },
      {
        img: 'endB2',
        caption: '구조 헬기가 내려오고 서치라이트가 운동장을 비춘다.',
        lines: ['구조대다.'],
      },
      {
        img: 'endB3',
        caption: '헬기에 오르며 돌아본 감방. 철창 너머 죄수의 눈빛.',
        lines: ['자리가… 하나뿐이었다.'],
        variants: {
          zombie: {
            img: 'endB3_alt',
            caption: '텅 빈 감방과 떨어진 열쇠 조각.',
            lines: ['자리가… 하나뿐이었다.'],
          },
        },
      },
      {
        img: 'endB4',
        caption: '멀어지는 헬기 아래로 감옥이 좀비에게 뒤덮인다.',
        lines: [],
      },
    ],
    final: 'THE END — 근무는 끝났다. 하지만 죄책감은 끝나지 않는다.',
  },
];

export function getEnding(id) {
  return ENDINGS.find((e) => e.id === id) || null;
}

/** end_reason에 맞춰 대체 컷을 적용한 컷 목록 */
export function resolveCuts(ending, endReason) {
  return ending.cuts.map((cut) => {
    const v = cut.variants && cut.variants[endReason];
    return v ? { ...cut, ...v } : cut;
  });
}

const DEX_KEY = 'zpb_endings_seen';

export function getSeenEndings() {
  try {
    return JSON.parse(localStorage.getItem(DEX_KEY) || '[]');
  } catch {
    return [];
  }
}

export function markEndingSeen(id) {
  try {
    const seen = new Set(getSeenEndings());
    seen.add(id);
    localStorage.setItem(DEX_KEY, JSON.stringify([...seen]));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}
