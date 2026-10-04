# MORSE / FIELD STATION

LDAP 認証付きのモールス信号訓練 Web アプリ。陸軍色の3カラム画面で、送信・受信・知識・判断を練習し、AI コーチから具体的な指導を受けられます。

## 起動

必要環境：Linux、Python 3.12 以上、Node.js 22.16 以上、uv、pnpm、ログイン済みの Codex CLI。Codex CLI 0.154.0 で接続確認しています。

```bash
uv sync --locked
pnpm install --frozen-lockfile
```

初回の別環境への導入時は `.env.example` を `.env` にコピーし、LDAP 接続値を設定してください。既存の `.env` は上書きしないでください。`.env`、認証状態、DB、ログは Git 管理対象外です。

```bash
codex login status
pnpm build
pnpm start
pnpm status
```

ブラウザーで **http://localhost:7631** を開きます。LAN 内の別端末からは、実行ホストのアドレスとポート `7631` を指定します。FastAPI が `0.0.0.0:7631` で画面と API の両方を配信します。WSL・仮想マシンで動かす場合、別端末からの到達にはホスト側のネットワーク転送とファイアウォール設定も関わります。

```bash
pnpm stop
```

`pnpm start` は端末終了後も動くローカルプロセスを起動します。OS 再起動後の自動起動は設定していません。PID は `.local/server.pid`、ログは `.local/server.log`。更新時は `pnpm stop` → `pnpm build` → `pnpm start` の順です。

開発時は `pnpm dev`。Vite を `0.0.0.0:7631`、FastAPI を `127.0.0.1:17631` で起動し、Vite が `/api` を転送します。通常起動と開発起動は同じ公開ポートを使うため、切り替える際は先に停止してください。

WSL2 の NAT 環境で LAN に公開する場合は、アプリ起動後、Windows の**管理者 PowerShell**で次を実行します。`Ubuntu` は使用しているディストリビューション名に合わせてください。

```powershell
& "\\wsl.localhost\Ubuntu\path\to\MorseCode\scripts\enable-wsl-lan.ps1" -Distribution Ubuntu
```

このスクリプトは7631番のポート転送と、同一サブネットからのTCPアクセスを許可する名前付きファイアウォール規則を設定します。実行前にアプリの応答を確認します。WSLのIPが変わった場合は再実行してください。元に戻す場合は同じコマンドに `-Remove` を付けます。詳細は[MicrosoftのWSLネットワーク説明](https://learn.microsoft.com/windows/wsl/networking)を参照してください。

## 操作

- **はじめてのモールス**：初回ログインでは入門を表示します。「モールス信号とは？」から短点・長点・間隔の意味を読み、E・T・Aのお手本を聴いて、一文字ずつ打ってみます。入門は5 WPMのゆっくりした練習で、成績には残りません。音が使えない場合も、表示と補助ボタンで練習できます。
- **操作ガイド（React Joyride）**：入門から「操作ガイドへ進む」を選ぶと、送信画面のメニュー・お題・打鍵キー・復号表示・判定・AIコーチを6段階で案内します。「戻る」「スキップ」、右上の閉じるボタン、Escで操作できます。ガイド中は打鍵を停止します。
- **送信訓練**：スペースキー、または画面の打鍵キーを押し続けて入力します。短点は1単位、長点は3単位、文字間は3単位。12 WPM ならそれぞれ100 / 300 / 300 msです。文字は自動確定されます。補助ボタンと手動の文字確定も使えます。
- **受信訓練**：「信号を聴く」で再生し、聴き取った文字を入力します。再生は繰り返せます。
- **知識ドリル**：符号、時間比率、速度の知識を確認します。
- **判断ドリル**：聞き取りにくい状況などへの対処を選びます。正答と15秒以内の判断が目標です。
- **AI コーチ**：右側から相談できます。自動講評を有効にすると、入力ミス後の停止時と課題判定後にAIが指導します。入力中の指摘は1課題につき最大1回、15秒以上の間隔を設けています。
- **訓練記録**：ユーザー別に回答、正解率、打鍵精度、判断時間を保存します。能力別・文字別の集計は直近200件、一覧は直近20件です。
- **訓練設定**：3段階のレベル、5〜40 WPM、1日の課題数、目標正解率を変更できます。変更は次の課題から適用され、目標に届かない文字を優先して出題します。

入門はいつでもスキップできます。訓練や操作ガイドへ進むと、初回案内の表示済み状態をユーザー別に保存し、次回から送信訓練を開きます。復習するときはメニューの「はじめてのモールス」「操作ガイド」を選んでください。既存ユーザーにも、この機能追加後の初回に入門を表示します。体験モードはログインするたびに新しいユーザーになるため、その都度入門を表示します。

初期版は国際モールスの英字・数字と一部記号に対応しています。基礎レベルは `KMUREST` の7文字から始まります。和文モールスは未実装です。補助入力を混ぜた課題は、打鍵時間の精度を採点しません。音声はユーザー操作後に開始されます。

## 認証設定

| 変数 | 意味 |
| --- | --- |
| `LDAP_URL` | `ldap://` または `ldaps://` の接続先 |
| `LDAP_BIND_DN` / `LDAP_BIND_CREDENTIALS` | 検索用アカウント。両方空なら匿名検索 |
| `LDAP_USER_SEARCH_BASE` | 検索対象のベース DN |
| `LDAP_SEARCH_FILTER` | `{{username}}` を含む検索条件。入力は LDAP フィルター用にエスケープ |
| `LDAP_LOGIN_USES_USERNAME` | `true` はユーザー名で検索して得た DN で認証。`false` は入力 DN がベース配下か検証して認証 |
| `LDAP_ID` / `LDAP_USERNAME` / `LDAP_FULL_NAME` | 永続ID・ログイン名・表示名の属性 |
| `LDAP_EMAIL` | 追加検索するメール属性。初期版では保存・表示しない |
| `LDAP_STARTTLS` | STARTTLS を使用。LDAPS とは併用不可 |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | 証明書検証。既定値 `true` |
| `LDAP_CA_CERT_PATH` | 独自 CA 証明書のパス |
| `LDAP_ALLOW_PLAINTEXT` | TLSなしのLDAPを明示的に許可。既定値 `false` |
| `LDAP_CONNECT_TIMEOUT_SECONDS` | 接続・受信・検索のタイムアウト。既定値5秒 |
| `LDAP_LOGIN_NOTICE_EMPHASIS_UNTIL` | 平文接続の案内を強調表示する期限。ISO 8601形式 |
| `MORSE_COOKIE_SECURE` | HTTPS運用時に `true`。HTTPのLAN試作では `false` |

`LDAP_LOGIN_USES_USERNAME=true` でも、`uid` の文字列を直接 DN として bind しません。検索で一意に見つかったユーザーの DN と、入力されたパスワードで認証します。空のパスワードは拒否し、パスワードは保存しません。

セッションは HttpOnly / SameSite=Strict Cookie を使い、サーバー側にはトークンのハッシュのみ保存します。有効期間は8時間、ログアウトで失効します。書き込み API は同一オリジンと独自ヘッダーを確認します。認証失敗の回数制限とリクエストサイズ制限があります。

体験ログインは既定で無効です。ローカルで確認する場合だけ `MORSE_DEMO_ENABLED=true` を指定します。有効時は認証なしで体験セッションを作成できるため、共有環境では無効のまま運用してください。E2E テストは別の DB とループバック上のポートでのみ体験機能を使います。

## AI コーチの接続

React の CopilotKit headless API → AG-UI SSE → FastAPI → Codex App Server の stdio JSON-RPC という構成です。OpenAI API キーをブラウザーへ渡しません。Codex が使えるアカウントで実行ホスト側の `codex login` を済ませてください。

| 変数 | 意味 |
| --- | --- |
| `CODEX_COMMAND` | Codex 実行ファイル。既定値 `codex` |
| `CODEX_MODEL` | 使用モデル。空ならインストール済み Codex の既定モデル |
| `CODEX_TIMEOUT_SECONDS` | 1回の応答の上限。既定値90秒 |
| `CODEX_MAX_CONCURRENT` | 同時実行数。既定値2 |
| `MORSE_CODEX_HOME` | コーチ専用の設定領域。既定値 `.local/coach-codex` |

専用設定領域に認証状態がなければ、実行ユーザーの既存 Codex 認証ファイルへのローカルシンボリックリンクを作成します。既存の MCP・プラグイン設定は引き継ぎません。別アカウントに分離する場合は、リンクを使用する前に専用領域でログインしてください。

```bash
CODEX_HOME="$PWD/.local/coach-codex" codex login
```

応答ごとに新しい ephemeral thread を作り、直近の会話と練習結果を渡します。シェル、複数エージェント、Apps、Web検索を無効にし、read-only モードで起動します。サーバーからのツール実行・承認要求も拒否します。LDAPの認証情報・ユーザーID・表示名を学習コンテキストへ含めません。手入力したチャットと練習情報は、回答を生成するためCodexへ送られます。

AI の自然言語応答にはネットワーク・推論の待ち時間があります。符号判定と長短点の測定はブラウザーで即時実行し、AI が接続できない間も練習と採点は続行できます。チャット履歴は現在の画面内で保持され、再読み込みするとリセットされます。成績はDBに残ります。

Jev は調査時点で公式の公開API・導入手順を確認できなかったため使用していません。接続層を独立させてあり、公開された場合は AG-UI 側の契約を保って差し替えられます。

## 検証

```bash
uv run pytest -q
uv run ruff check backend scripts
uv run ruff format --check backend scripts
pnpm typecheck
pnpm format:check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --prod --audit-level high
```

自動テストでは、LDAP の検索・DN bind・TLS・認証失敗、セッション・CSRF・所有者分離、採点・保存、Codex JSON-RPC、AG-UI ストリーム、実際のブラウザー打鍵・受信音・画面遷移・モバイル表示を検証します。入門のE・T・Aの実打鍵、案内のユーザー別保存と保存失敗時の継続、Joyrideの全ステップ・戻る・スキップ・再表示・Esc終了も確認します。LDAP の実アカウント認証はアカウント入力後に確認してください。AI を使う E2E は決定的な AG-UI 応答で検証し、実 Codex 接続は別途確認します。

`ldap3 2.9.1` 内部から `pyasn1` の旧属性名に関する非推奨警告が2件出ます。第三者パッケージ由来で、抑制はしていません。認証・TLS テストは通ります。`hast` の非推奨通知は CopilotKit の間接依存です。不要な `@scarf/scarf` インストール時スクリプトは実行しません。

## 構成と参考資料

```text
frontend/src/       Reactの画面、打鍵フック、Web Audio、CopilotKit
backend/app/        FastAPI、LDAP、SQLite、採点、Codex接続
shared/            フロント・バック共通の符号表と課題データ
backend/tests/     Pythonテスト
e2e/               Playwrightブラウザーテスト
scripts/           開発・通常起動
docs/              設計判断
.local/            DB・ログ・実行状態（Git対象外）
```

- [設計判断](docs/architecture.md)
- [Codex App Server 公式ドキュメント](https://developers.openai.com/codex/app-server)
- [CopilotKit の AG-UI 接続](https://docs.copilotkit.ai/agno/backend/copilot-runtime)
- [AG-UI サーバープロトコル](https://docs.ag-ui.com/quickstart/server)
- [ldap3 の接続仕様](https://ldap3.readthedocs.io/en/latest/connection.html)
- [ITU-R M.1677 国際モールス](https://www.itu.int/rec/R-REC-M.1677-1-200910-I/en)
- [React Joyride v3 公式ドキュメント](https://react-joyride.com/docs/getting-started)
