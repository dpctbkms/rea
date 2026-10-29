#!/usr/bin/env bash
# Stop 훅: 코드가 바뀌었는데 docs/PROGRESS.md가 그보다 늦게 갱신되지 않았으면 멈추지 말고 갱신하라고 돌려보낸다.
# 같은 멈춤에서 두 번째 호출(stop_hook_active)이면 그냥 통과해 무한 반복을 막는다.
input=$(cat)
if printf '%s' "$input" | grep -q '"stop_hook_active" *: *true'; then exit 0; fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

P=docs/PROGRESS.md
stale=""
if [ ! -f "$P" ]; then
  stale="$P 파일이 없습니다."
elif [ -n "$(git status --porcelain -- "$P")" ]; then
  :  # 기록을 고치는 중
elif [ -n "$(git status --porcelain -- . ":(exclude)$P")" ]; then
  stale="커밋하지 않은 코드 변경이 있는데 $P는 그대로입니다."
else
  code=$(git log -1 --format=%H -- . ":(exclude)$P")
  prog=$(git log -1 --format=%H -- "$P")
  if [ -n "$code" ] && { [ -z "$prog" ] || ! git merge-base --is-ancestor "$code" "$prog"; }; then
    stale="마지막 코드 커밋($(git log -1 --format=%h "$code")) 뒤로 $P가 갱신되지 않았습니다."
  fi
fi

[ -z "$stale" ] && exit 0
reason="$stale 이번 작업 내용을 $P의 '진행 중', '완료', '해야 할 일'에 반영하고 커밋·푸시한 뒤 끝내세요. 이번 작업이 질문 답변뿐이었다면 무시해도 됩니다."
printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$reason" | jq -Rs .)"
