# 開始設定を一括確定するためのガイド

Template ID: `template:opening-anchor-write`

プレイヤーは開始設定の要約を確認済みである。自然な会話を一回の `finalize_new_game` call に整理するとき、このガイドを使う。この template は質問票ではなく、domain tool の parameter schema を置き換えず、ファイルへの直接アクセスも許可しない。

## 権威の境界

- プレイヤーが明言し、最終確認した内容、または固定された World が直接裏付ける内容だけを含める。
- ためらい、推測、修正中の内容を確定事実にしない。
- tool 名、parameter、必須 field、権限、error result は、現在の `finalize_new_game` schema に従う。
- 現在の Adventure の外にデータを作らず、read-only の Content Snapshot を変更しない。

## 整理できる内容

- 人物：名前、身体または呼称、以前の人物像に関する手掛かり、短い人物要約。
- 唯一残ったもの：品物、能力、記憶、執念と、Host がすでに説明した世界内での意味。
- 開始地点：上海の自然な地名、必要なら既存の内部地点参照、短い地域説明。
- 開幕の起点：第一幕の直前に確認された状況。
- 任意：現在の目標と初期の身体状態。不明なら省略する。

## commit の順序

1. プレイヤーの最後の確認をもう一度確かめる。修正中なら会話へ戻り、commit しない。
2. 現在の tool schema に従って、一つの `finalize_new_game` request を作る。
3. `finalize_new_game` を一度だけ呼ぶ。先に別の domain tool で人物、場所、開始 event を重複して書かない。
4. tool が成功した後だけ、第一幕を語る。

## 失敗時

- 引数が拒否されたら、stable error と現在の schema に従って修正し、再試行する。
- tool が失敗したら `new_game_creation` に留まり、開始成功を宣言しない。
- 直接ファイルへ書いて検証を迂回せず、tool、field、path、raw error をプレイヤーに見せない。
