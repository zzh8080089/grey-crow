# 場所プロファイルの template

Template ID: `template:location-profile`

場所、部屋、集落、経路の起点、目印、継続する環境の特徴を作成または更新するときに使う。

日本語版では、`name` と `summary` を自然な日本語にする。外国語の自然な地名はそのまま表示名にできる。

`record_location_memory` の parameter の例：

```json
{
  "name": "虹口サッカー場",
  "summary": "雨と仮設シートに切り分けられた古い競技場。外周には改札と観客席への通路がまだ見える。",
  "authority": "narrative_event"
}
```

規則：

- `name` は表示可能な地名にし、`summary` は継続的価値の高い短い要約にする。
- 既存の場所を更新するときは、先に検索し、返された `reference` をそのまま送る。新しい場所の reference を作らない。
- 新しい経路と場所の詳細は現在のゲームの世界記録に属する。主要場面が変化した場合だけ game-state を別に読む。
- 未確認の内容は `player_claim`、`rumor`、`attempt` のいずれかを使い、確定した事実に格上げしない。
- Runtime が記録構造、検証、冪等性、file 書き込みを担当する。宣言されていない field を追加しない。
