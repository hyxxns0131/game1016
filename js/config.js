// 게임 밸런스 수치는 전부 여기서 조정한다.
// ※ GAME_DURATION을 바꾸면 supabase/schema.sql 의 end_game 함수의 600초도 같이 바꿀 것.

export const TILE = 32;

export const GAME = {
  GAME_DURATION: 600,      // 제한시간(초) — 10분
  REVEAL_SECONDS: 3,       // 역할 공개 연출
  COUNTDOWN_SECONDS: 3,    // 카운트다운
  NET_RATE: 15,            // 플레이어 위치 broadcast (회/초)
  ZOMBIE_NET_RATE: 10,     // 좀비 위치 broadcast (회/초, 방장)
  DISCONNECT_GRACE_MS: 4000,
};

export const PLAYER = {
  radius: 11,
  walkSpeed: 120,
  runSpeed: 200,
  stamina: 100,
  staminaDrain: 28,        // 달리는 동안 초당 소모
  staminaRegen: 16,        // 초당 회복
  staminaMinToRun: 25,     // 바닥난 뒤 다시 달리려면 필요한 양
  crouchSpeed: 62,         // 앉아서 이동(Z)
  crouchDetectMul: 0.5,    // 앉으면 좀비 감지 범위 배율
  crouchVisibleMul: 0.55,  // 앉은 죄수가 교도관 손전등에 보이는 거리 배율
  jumpTime: 0.5,           // 점프 체공 시간(초) — 공중에선 잡히지 않음
  jumpSpeed: 190,
  jumpStamina: 18,
  jumpCooldown: 0.9,
  landNoiseRadius: 150,
  runNoiseRadius: 230,     // 달리기 소음 반경(px)
  doorNoiseRadius: 200,    // 문 여닫기 소음 반경(px)
  prisonerLight: 190,
  guardAmbientLight: 95,
  guardFlashlight: 400,
  guardFlashlightAngle: 70, // 도
};

export const PRISONER = {
  keysNeeded: 3,
  hideMax: 10,             // 사물함 최대 숨기 시간(초)
  hideCooldown: 4,
  arrestImmunity: 3,       // 체포 후 무적(초)
};

export const GUARD = {
  maxLocks: 3,
  lockCooldown: 6,         // 문 잠근 뒤 다음 잠금까지(초)
  arrestRange: 28,
};

// 난이도 단계. from = 경과 시간(초)
export const PHASES = [
  { key: 'low',  name: '하', from: 0,   count: 6,  speedMul: 0.45, detect: 120, hearingMul: 0.6, wanderMul: 0.6, group: false, brutes: 0 },
  { key: 'mid',  name: '중', from: 180, count: 12, speedMul: 0.85, detect: 190, hearingMul: 1.25, wanderMul: 0.7, group: true,  brutes: 0 },
  { key: 'high', name: '상', from: 360, count: 20, speedMul: 1.0,  detect: 270, hearingMul: 1.6, wanderMul: 0.75, group: true, brutes: 3 },
];

export const ZOMBIE = {
  radius: 12,
  catchDist: 22,
  bruteCatchDist: 30,
  bruteSpeedMul: 0.85,     // 단계 속도 대비
  bruteDoorBreakTime: 2.5, // 잠긴 문 부수는 시간(초)
  spawnInterval: 1.4,      // 하수구에서 한 마리씩 나오는 간격
  loseSightTime: 3,
};
