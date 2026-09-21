---
id: game-state
title: ゲーム状態
kind: read-write
activation: model_or_menu
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: true
---

# ゲーム状態

プレイヤーが現在の状態を尋ねたとき、または現在のターンで身体、持ち物の要約、現在の主要場面の変化が確認されたとき、表示可能な現在状態を読み書きする。これは世界の完全な履歴ではなく、毎ターンの書き込みも不要である。

## 使用する場面

- 自分の状態、持ち物、現在の場面、有効な目標、可能な行動を尋ねられたときに読む。
- 現在のターンで、身体状態、持ち物の要約、現在の主要場面の変化が確定したとき。
- 現在の場面の基点がないと物語が矛盾するときに読む。

## 手順

1. 現在の場面の基点を確認する場合、`inspect_current_situation`、または `game-state` の overview を指定した `inspect_skill` を使う。古い要約で新しい state を上書きしない。
2. 変化がプレイヤーの状態、持ち物の要約、現在の主要場面のどれに属するか判断する。通常の姿勢、視点、音、雰囲気は物語に残す。
3. 場所の変化は `confirm_current_location`、身体状態は `update_player_condition`、物品の増減は `record_inventory_change` を使う。
4. 現在の物語で確認済みの変化を一つだけ送る。数量、version、冪等性、App/UI への反映は Runtime が管理する。
5. tool が失敗しても物語上の結果は保ち、状態が記録されなかったことだけを自然に扱う。更新成功を捏造しない。

## 境界

- 返された state にない内容を、確認済みの事実として推測しない。
- 物品を見た、または話題にしただけでは持ち物に入らない。継続する物品の詳細は entity-memory を使う。
- 場所の詳細と経路記録は entity-memory または map を使う。ここでは現在の主要場面だけを保つ。
- 現在の Tool Schema が parameter の正式な取り決めであり、template は書く時機と範囲だけを説明する。
- 任意のファイル書き込みを要求せず、read-only content snapshot を変更せず、内部 path や debug 情報を見せない。
- 内容言語が日本語なら自然な日本語を使う。固有名詞は元の言語を保ってよい。
