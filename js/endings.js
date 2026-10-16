// 엔딩 데이터. 새 엔딩은 여기에 항목만 추가하면 된다.
// 엔딩은 '보는 사람' 기준으로 고른다: role(내 역할) + win(내가 이겼는지).
// (end_game 함수가 기록하는 rooms.ending 은 승자 기준 escape / last_shift 로 그대로 남는다.)
// - cuts[].variants[end_reason]: 해당 종료 사유일 때 대체 컷(이미지/자막)
// - lines: 한 줄씩 타이핑되는 자막. 비어 있으면 그림만 보여준다.

export const ENDINGS = [
  {
    id: 'escape',
    title: '새벽의 탈주',
    role: 'prisoner',
    win: true,
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
    role: 'guard',
    win: true,
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
  {
    id: 'life_sentence',
    title: '끝나지 않는 형기',
    role: 'prisoner',
    win: false,
    thumb: 'loseP2',
    cuts: [
      {
        img: 'loseP1',
        caption: '06:00. 감방 철창을 붙잡은 채 사이렌을 듣는다.',
        lines: ['06:00. 사이렌이 울린다.', '정문은… 끝내 열리지 않았다.'],
        variants: {
          zombie: {
            img: 'loseP1_alt',
            caption: '떨어진 손전등 불빛 속으로 다가오는 발소리.',
            lines: ['어둠 속에서…', '무언가가 내 발목을 잡았다.'],
          },
        },
      },
      {
        img: 'loseP2',
        caption: '철창 창문 너머로 멀어지는 구조 헬기.',
        lines: ['멀어지는 헬기 소리.', '나를 위한 자리는 없었다.'],
      },
      {
        img: 'loseP3',
        caption: '감방 벽의 날짜 표시와 끝내 맞추지 못한 열쇠 조각.',
        lines: ['열쇠 조각은… 끝내 셋이 되지 못했다.'],
      },
    ],
    final: 'GAME OVER — 형기는 아직 끝나지 않았다.',
  },
  {
    id: 'abandoned_post',
    title: '버려진 초소',
    role: 'guard',
    win: false,
    thumb: 'loseG1',
    cuts: [
      {
        img: 'loseG1',
        caption: '활짝 열린 정문. 안개 속으로 사라지는 주황색 등.',
        lines: ['문이… 열려 있었다.', '놈은 이미 안개 너머로 사라졌다.'],
        variants: {
          zombie: {
            img: 'loseG1_alt',
            caption: '경비실 바닥에 떨어진 손전등과 모자. 깜빡이는 모니터.',
            lines: ['무전기 너머로…', '대답은 없었다.'],
          },
        },
      },
      {
        img: 'loseG2',
        caption: '지직거리는 감시 모니터. 창밖으로 떠나는 헬기.',
        lines: ['구조 헬기는 기다려주지 않았다.'],
      },
      {
        img: 'loseG3',
        caption: '잿더미 위에 떨어진 교도관 배지.',
        lines: ['…교대자는 오지 않는다.'],
      },
    ],
    final: 'GAME OVER — 마지막 근무자는 돌아오지 못했다.',
  },
];

/** 보는 사람 기준 엔딩: 내 역할 + 승패 */
export function pickEnding(myRole, iWon) {
  return ENDINGS.find((e) => e.role === myRole && e.win === iWon) || null;
}

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
