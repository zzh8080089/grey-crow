---
id: entity-memory
title: 人物と世界の記憶
kind: read-write
activation: model_can_invoke_when_entity_or_world_fact_is_relevant
modelInvocation: model_can_invoke
danger: medium
requiresConfirmation: false
userMenuCommand: false
---

# 人物と世界の記憶

人物、場所、勢力、名前のある物品、噂、過去の出来事が現在のターンに影響するとき、現在のゲームにある意味記録を必要に応じて読む、または更新する。読み書きはモデルが判断する。トリガーの手掛かりは Skill を見つけやすくするだけで、強制条件ではない。

## 使用する場面

- 継続する人物、場所、勢力、物品が再登場した、または初めて重要になったとき。
- ある対象が既知である、存在する、所有されている、敵対または同盟関係にある、継続的に変化した、と断定する前。
- プレイヤーが古い手掛かり、噂、関係、場所に触れ、最近の会話だけでは詳細を確認できないとき。

## 手順

1. 書き込む前に `inspect_skill(skill: "entity-memory", view: "lookup", query: ...)` で既存記録を探す。直近だけを見る場合は `recent` を使う。
2. 既存の場所または物品を更新するときは返された `reference` を再利用する。同一対象かどうかは物語に基づいてモデルが判断する。
3. 場所は `record_location_memory`、名前のある物品や手掛かりは `record_item_memory` を使い、名前、短い要約、authority、任意の reference だけを送る。
4. プレイヤーの主張、試み、噂には、それぞれに合う未確認の authority を保ち、自動的に確認済みへ引き上げない。
5. 右側の現在状態にも変化を表示する必要がある場合、game-state を別に読む。domain record 自体は UI を自動変更しない。

## 書き込み境界

- 人物は Character Skill の具名 action、場所は `record_location_memory`、物品は `record_item_memory` を使う。勢力や重要な経過には、現在 Router が公開している対応領域 action を使う。
- authority は `soft`、`player_claim`、`rumor`、`attempt`、`narrative_event` のいずれかだけを使う。
- 現在の Tool Schema が field、長さ、型についての正式な取り決めである。path、file name、template ID、未宣言 field を追加しない。
- read-only World card、Skill、Content Snapshot を変更せず、任意の file tool を使わない。
- 普通の物語を強制的な state machine にしない。継続して覚える価値があるときだけ書き、失敗しても自然な応答を妨げない。
