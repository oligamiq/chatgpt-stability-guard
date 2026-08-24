# Stability Guard for ChatGPT

長大なChatGPT Web会話の重さと表示の混雑を軽減するManifest V3 Chrome拡張。古いターン、Thinking / reasoning、tool trace、壊れたAppプレビューや古いエラー、code / logなどを端末内だけで選択的に抑制し、ChatGPT上の会話履歴そのものは削除しない。

A local-only Manifest V3 extension for reducing lag and clutter in long ChatGPT conversations by selectively suppressing old turns, Thinking/reasoning, tool traces, stale app errors, broken preview remnants, and other heavy UI without deleting chat history.

> **互換性に関する重要事項**
> この拡張は、現在のChatGPT Web UIのDOM/属性構造に合わせて実装されている。ChatGPT側のサイト更新でDOMやUI構造が変わると、検出・非表示・プレースホルダ抑制の一部または全部が一時的に動作しなくなる場合がある。その場合は拡張側の更新が必要。

本拡張は独立した非公式プロジェクトであり、OpenAIによる作成・承認・提携製品ではない。

## 機能

- Thinking / reasoning候補の非表示
- MCP / tool trace本体の非表示
- `Called tool` 等のツール概要行の非表示
- configカード等の埋め込みツールUIの非表示
- rich UI読込中プレースホルダのプリハイド
- 古い `Failed to fetch template` アプリ読込エラーの非表示（最新turnのものは残す・既定ON）
- traceの低コントラスト化・高さ制限
- アニメーション/transition抑制
- code / log (`pre`) の遅延描画
- **直近N回 + 過去履歴アコーディオン**（既定OFF、Nの既定値は3。直近N件は常時表示し、それ以前は1つのアコーディオン操作から一時展開できる。展開中は通常スクロールへ戻り、折りたたむとsemantic boundaryへ安全に復帰。ChatGPTの会話DOMは削除・移動せず、branch/editや大きな仮想化構造変更ではrecent-Nだけfail-open）
- 古い会話ターンの遅延描画（Aggressive・既定OFF）
- 現在ページで何件非表示・遅延描画しているかの表示
- 機能ごとのON/OFF（設定変更はページ再読み込み後に反映）

## プライバシー

- 会話内容を外部送信しない
- 会話内容を拡張ストレージへ保存しない
- 解析、広告、テレメトリ、リモート設定、開発者バックエンドなし
- 設定・UI言語のみ `chrome.storage.local` に保存

詳細: [PRIVACY.md](PRIVACY.md)

## インストール（開発・手動）

1. このリポジトリのフォルダをローカルに保持する。
2. `chrome://extensions` または `edge://extensions` を開く。
3. デベロッパーモードをON。
4. 「パッケージ化されていない拡張機能を読み込む / Load unpacked」でこのフォルダを選ぶ。
5. ChatGPTタブを再読み込みする。

**Load unpackedは選択したフォルダを実体として参照するため、読込後にそのフォルダを削除・移動しないこと。**

## 日本語 / English UI

1.0.10以降、拡張UIは日本語と英語に対応する。既定は `Auto` でブラウザ言語が日本語なら日本語、それ以外は英語を表示する。ポップアップの言語セレクタから `日本語` / `English` を明示的に選択でき、設定は `chrome.storage.local` に保存される。Privacy画面、recent-Nの進捗表示、ページ内Guard状態表示にも同じ選択を適用する。

## Microsoft Edge for Android

1.0.9以降はAndroid版Microsoft Edgeを互換対象に含める。ManifestはChrome/Edge共通のMV3を維持し、Edge専用の追加権限やネイティブ機能には依存しない。

- 拡張ポップアップは狭い画面・coarse pointer向けに可変幅化し、タッチ対象とsafe areaを拡大。
- recent-N専用スクロールバーは`VisualViewport`を追跡し、モバイルのアドレスバーやソフトキーボードによる表示領域変化に追従。
- `chrome.tabs`が一時的に利用できない実装でもポップアップ全体が停止しないようfail-safe化。
- Store提出物はChrome Web StoreとMicrosoft Edge Add-onsで同じ`dist/stability-guard-for-chatgpt-<version>.zip`を使用できる。

Android版Edgeでの一般配布はMicrosoft Edge Add-ons側でモバイル対応として提供されることを前提とする。デスクトップ向けの`Load unpacked`手順をAndroidでも利用できるとは仮定しない。

## 検証

```bash
python3 scripts/test.py
```

静的検証、JavaScript構文チェック、Headless Chromeによる `Failed to fetch template` 回帰テストをまとめて実行する。

### CI / ChatGPT Web互換性監視

`.github/workflows/compatibility.yml` はpush / pull request時に全回帰テストを実行し、さらに毎日09:17 JST（00:17 UTC）と手動実行時には公開ChatGPT shareページを使ったlive互換性検査も行う。

live検査は2段構成。`scripts/live_site_contract.py` が会話turn、role、scroll root、安定属性、祖先構造など拡張が依存するDOM構造を正規化して `scripts/live_site_baseline.json` と比較する。`scripts/live_site_smoke.mjs` は実サイトをHeadless Chromeで開き、現在のDOMへGuard本体とRecent-Nを直接注入して、初期化、Recent-Nのready/collapsed遷移、古いturnの抑制、履歴アコーディオン表示まで確認する。DOM全文や会話本文はartifactへ保存しない。

公開shareページでは認証済みprivate chatにあるtool trace/App mountが描画されない場合があるため、live smokeが保証するのは公開ページで観測できるcore conversation / Recent-Nの互換性である。tool summary、App preview、Connect/Retry等のtool固有DOMは、実際に観測したproduction DOMをfixture化した `test_ui_isolation.py` 等の回帰テストで毎回検査する。監視URLとしてtool UIを保持する公開shareを用意できた場合は `CSG_LIVE_CHAT_URL` を差し替えてbaselineを更新できる。

互換性契約の差分または実サイト上の機能smoke失敗を検出すると `[CI] ChatGPT site compatibility regression` Issueを自動作成する。同じ障害が続く間は既存Issueへ診断結果を追記し、全検査が再び成功した時点で自動closeする。`automated` / `site-compatibility` labelが無ければCIが作成する。Cloudflare challenge、ネットワーク断、Chrome起動失敗など監視基盤側の異常はworkflow自体を失敗させるが、サイト互換性Issueとしては起票しない。

監視対象URLはRepository variable `CSG_LIVE_CHAT_URL` で公開 `/share/...` URLへ差し替えられる。意図したDOM変更へ対応した後だけ、差分を確認したうえで次を実行してbaselineを更新する。

```bash
CSG_LIVE_CHAT_URL=https://chatgpt.com/share/... python3 scripts/live_site_contract.py --update-baseline
```

baselineはCIから自動更新しない。サイト変更を検出しただけで新構造を自動承認しないためである。

## Chrome Web Store / Microsoft Edge Add-ons用パッケージ

```bash
python3 scripts/test.py
python3 scripts/package.py
```

`dist/stability-guard-for-chatgpt-<version>.zip` が生成される。Store提出ZIPでは開発用の固定`key`を自動的に除外する。

## 設計方針

- ChatGPTのfetch / WebSocket / 内部APIを変更しない
- React管理ノードを削除・移動しない
- 外部コードやリモート設定を読み込まない
- DOM分類はMutationObserver + idleバッチ処理
- 対話表示制限はユーザー発言を対話境界として数え、更新は通常タイマーでも追従
- 統計の全体集計はポップアップを開いた時だけ実施
- 対象サイトは `https://chatgpt.com/*` のみに限定

## 公開

Chrome Web Store掲載に必要な文面・画像・チェックリストは [PUBLISHING.md](PUBLISHING.md) と `store-assets/` を参照。
