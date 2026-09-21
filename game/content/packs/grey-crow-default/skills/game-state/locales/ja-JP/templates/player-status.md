# プレイヤー状態の template

Template ID: `template:player-status`

現在のターンで、身体状態、疲労、感染、負傷、その他の表示可能な状態変化が確認されたときに使う。旧い値を確認する必要がある場合は、先に `inspect_current_situation` を使う。

`update_player_condition` の parameter の例：

```json
{
  "status": "右腕に軽い切り傷、圧迫で止血済み"
}
```

規則：

- `status` は現在の短い状態であり、完全な病歴ではない。
- プレイヤーが想像し、虚偽を述べ、または状態変更を試みただけなら更新しない。
- 比喩表現から、自動治療、自動負傷、自動消費を行わない。
- Runtime が revision、冪等性、UI への反映を担当する。理由、旧値、内部 field を追加しない。
