# Microsoft Edge Add-ons listing — 日本語

## タイトル
Stability Guard for ChatGPT

## 短い説明
長大なChatGPT会話の重さと表示の混雑を軽減。古いターン、Thinking、ツールUI、古いエラーなどを端末内だけで選択的に抑制します。

## 詳細説明
長いChatGPT会話では、古いターン、Thinking / reasoning、ツール履歴、埋め込みApp、エラー、code / logなどが積み重なり、スクロールや描画が重くなったり画面が混雑したりします。Stability Guard for ChatGPT は、それらの描画負荷を端末内だけで抑え、ChatGPT上の会話履歴そのものは削除しません。会話内容を開発者サーバーへ送信したり保存したりしません。

主な機能:
- Thinking / reasoning 表示の非表示
- MCP / tool trace本体やツール概要行の非表示
- configカード等の埋め込みツールUIと読込中プレースホルダの抑制
- 最新turn以外の `Failed to fetch template` 読込エラーの非表示
- traceの低コントラスト化・高さ制限
- code / log の画面外遅延描画
- 直近N回の対話だけ表示（任意・既定OFF、N=3）
- 古い会話ターンの遅延描画（任意・既定OFF）
- 現在の非表示・遅延描画件数の表示
- 各最適化を個別にON/OFF

Androidを含むモバイル環境では、狭い画面・タッチ操作・safe area・Visual Viewportの変化に対応しています。
### 互換性
現在のChatGPT Web UIのDOM/属性構造を対象にしています。ChatGPT側の更新で構造が変わると、一部の検出や軽量化が一時的に動作しなくなる場合があります。その場合は拡張側の更新が必要です。

### データの扱い
拡張は表示済みDOMを端末内だけで処理します。会話内容の外部送信・永続保存、広告、解析、テレメトリ、リモート設定、開発者運営バックエンドはありません。保存するのは設定とUI言語だけで、拡張ローカルストレージを利用します。ポップアップからプライバシーポリシーをいつでも確認できます。

### 非公式拡張
本拡張は独立した非公式プロジェクトであり、OpenAIによる作成・承認・認定・提携・スポンサー製品ではありません。

## 検索語候補
ChatGPT, performance, long chat, rendering, stability, mobile

拡張UIは日本語と英語に対応し、既定ではブラウザ言語を自動判定する。ポップアップから手動で言語を切り替えることもできる。
