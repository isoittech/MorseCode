# AGENTS.md

## 方針
- 日本語で報告する。コンパクトな文字とオリーブ・カーキ系の3カラム画面を維持する。
- 公開ポートは7631。通常起動はFastAPIが画面とAPIを配信する。開発時のみViteとループバックAPIに分ける。
- `.env`、`.local/`、認証状態、DB、ログ、実際のLDAP接続値をGitやドキュメントへ追加しない。
- main/masterへ直接コミットしない。コミットは日本語のConventional Commits、ファイル別の説明を本文に含める。

## コマンド
- セットアップ：`uv sync --locked`、`pnpm install --frozen-lockfile`
- 開発：`pnpm dev`。通常起動：`pnpm build` → `pnpm start`。停止：`pnpm stop`。
- Python：`uv run pytest -q`、`uv run ruff check backend scripts`、`uv run ruff format --check backend scripts`
- フロント：`pnpm typecheck`、`pnpm format:check`、`pnpm test`、`pnpm build`
- E2E：ビルド後に `pnpm test:e2e`。初回は `pnpm exec playwright install chromium`。

## 重要な境界
- 符号表・課題素材は `shared/curriculum.json` を唯一の情報源にする。
- 即時判定はブラウザー、最終採点・保存はFastAPI、説明はAIに分ける。補助入力に時間精度を付けない。
- `LDAP_LOGIN_USES_USERNAME=true` は検索モード。認証bindには検索結果のDNを使い、uid文字列を直接DNとして渡さない。
- 体験ログインは既定で無効。テストの体験ログインを共有環境へ有効化しない。
- LANのHTTPでは `crypto.randomUUID` が利用できない場合がある。`lib/api.ts` の `newId` とフォールバックを保持する。
- CopilotKitは公開headless/contextエントリーを使用する。上位の表示Providerを再導入すると未使用レンダラーで配信サイズが増える。設計は `docs/architecture.md` を参照。
- Codex App Serverの `thread/start.sandbox` は `read-only`。`turn/start.sandboxPolicy.type` の `readOnly` と混同しない。
- `turn/start` の応答より前の通知を取りこぼさない。別threadの通知を転送しない。ツール・承認要求は拒否する。
- チャットにLDAPの認証情報やユーザープロフィールを渡さない。モデルエラーを偽の回答で隠さない。
- 入門の打鍵はブラウザー内だけで扱い、課題・成績へ保存しない。Joyride表示中は通常の打鍵フックを停止する。
- Joyrideはv3のnamed exportと`onEvent`を使う。ガイド対象の`data-tour`属性を保ち、画面変更時はデスクトップ・モバイルの全ステップをE2Eで確認する。
- 初回案内の表示済み状態はユーザーの設定JSONに保存する。設定更新はJSONの部分マージとし、訓練設定の保存で表示済み状態を消さない。

## テストと注意点
- E2Eは17632番のループバックAPIと専用DBを使用する。通常DBを消去しない。
- E2EのAI応答はAG-UIをモックする。実Codex接続の確認と区別して報告する。
- `ldap3`の`pyasn1`旧属性警告は依存側の既知事項。警告抑制やsite-packagesの書き換えで隠さない。
- スキーマ変更時は既存DBの移行を用意する。現在のuser_versionは1。
