# Stability Guard for ChatGPT

長大なChatGPT Web会話で、Thinking・tool UI・コード/ログ・古いターンなどの描画負荷を抑えるManifest V3 Chrome拡張。

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
- **直近N回の対話だけ表示**（既定OFF、Nの既定値は3。ChatGPTの仮想スクロールを壊さずsemantic boundaryを固定し、直近N範囲専用スクロールバーで操作。branch/editや大きな仮想化構造変更を検出した場合は安全のためrecent-Nだけfail-openし、ページ再読み込み後に再構築）
- 古い会話ターンの遅延描画（Aggressive・既定OFF）
- 現在ページで何件非表示・遅延描画しているかの表示
- 機能ごとのON/OFF（設定変更はページ再読み込み後に反映）

## プライバシー

初回有効化前に、`chatgpt.com` の描画済みページ内容を端末内で処理することを明示して同意を求める。同意するまで会話DOMの走査は開始しない。

- 会話内容を外部送信しない
- 会話内容を拡張ストレージへ保存しない
- 解析、広告、テレメトリ、リモート設定、開発者バックエンドなし
- 設定・同意状態のみ `chrome.storage.local` に保存

詳細: [PRIVACY.md](PRIVACY.md)

## インストール（開発・手動）

1. このリポジトリのフォルダをローカルに保持する。
2. `chrome://extensions` または `edge://extensions` を開く。
3. デベロッパーモードをON。
4. 「パッケージ化されていない拡張機能を読み込む / Load unpacked」でこのフォルダを選ぶ。
5. 拡張ポップアップでデータ処理の説明を読み、同意する。
6. ChatGPTタブを再読み込みする。

**Load unpackedは選択したフォルダを実体として参照するため、読込後にそのフォルダを削除・移動しないこと。**

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
