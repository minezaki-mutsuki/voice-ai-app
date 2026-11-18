# 依頼：Connect Four 音声AIアプリのソースコード一式を作成してください

PythonとHTML・JavaScriptを使用して、Azure OpenAIと連携するリアルタイム音声AI Webアプリを作成してください。

最終的には、ボードゲーム「コネクトフォー（四目並べ）」の対戦相手として、ゲーム状況に応じて感情が変化したり、ハッタリを言ったりするAIを実現したいです。

**ソースコード一式を実際のファイルとして生成し、ZIP形式でダウンロードできるようにしてください。**

## 1. 開発方針

- Windows PCで動作するローカルWebアプリとする。
- Reactなどのフレームワークは使用しない。
- フロントエンドはHTML・CSS・JavaScriptで実装する。
- バックエンドはPythonのFastAPIで実装する。
- Azure OpenAIへの接続には、既存のAzureリソースを使用する。
- APIキーはPythonバックエンド側で管理し、フロントエンドへ公開しない。
- Pythonの仮想環境は必須とせず、通常のPython環境で起動できるようにする。
- `http://localhost:8000/index.html` でアクセスできるようにする。
- 2人で共同開発するため、機能ごとにソースコードを分離する。
- GitHubにアップロードできるフォルダ構成にする。

## 2. Azure OpenAIの接続設定

以下の環境変数を使用する。

```env
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://talkingai-openai2.openai.azure.com/
AZURE_OPENAI_API_KEY=
AZURE_CHAT_DEPLOYMENT=gpt-6-luna
AZURE_REALTIME_STT_DEPLOYMENT=gpt-realtime-whisper
AZURE_BATCH_STT_DEPLOYMENT=gpt-transcribe
```

APIキーは空欄とし、実際の値は生成しないこと。

`.env.example` を作成し、実際のAPIキーは利用者がローカル環境の `.env` に設定する方式にする。

`.gitignore` を作成し、`.env` や認証情報がGitHubへアップロードされないようにする。

**APIキーをHTML・JavaScript・ブラウザの通信URLへ埋め込まないこと。**

## 3. 音声AIの基本機能

以下の機能を実装する。

### ① リアルタイム音声認識

- ブラウザのマイクから音声を取得する。
- Azure OpenAIの`gpt-realtime-whisper`を利用する。
- WebSocketでリアルタイムに音声を送信する。
- 認識したテキストをWeb画面に表示する。
- 発話の区切りを検出して、チャットAIへ送信する。
- 音声認識中の状態を画面に表示する。

### ② AIとの会話

- 音声認識結果をAzure OpenAIの`gpt-6-luna`へ送信する。
- AIの返答をテキストで表示する。
- 過去の会話履歴を保持し、文脈を踏まえて返答する。
- ストリーミング応答に対応する。
- テキスト入力でもAIと会話できるようにする。

### ③ 音声読み上げ

- ブラウザ標準のSpeechSynthesis APIを利用する。
- AIの返答を日本語で読み上げる。
- AIの読み上げ中は、マイクがAIの音声を再認識しないようにする。
- 音声のON/OFFを切り替えられるようにする。

## 4. コネクトフォー連携機能

ゲームロジック班から盤面情報をJSON形式で受け取ることを想定する。

現時点ではゲームロジック班のAPIが未完成なので、まずはダミーデータで動作確認できるようにする。

例えば以下のJSONを使用する。

```json
{
  "event": "robot_turn_started",
  "turn": "robot",
  "game_status": "playing",
  "advantage": "losing",
  "previous_advantage": "even",
  "opponent_threat": true,
  "robot_move_column": 4
}
```

画面上で以下を変更できるようにする。

- 現在のターン（人間／ロボット）
- ゲーム状態（開始前／対戦中／終了）
- 盤面評価（AI有利／互角／AI不利）
- 相手の勝利が迫っているか
- ロボットが次に置く列番号（1～7）

将来的にREST APIやWebSocketからゲーム情報を取得できるよう、ゲーム状態の取得処理を独立したモジュールにする。

## 5. 感情が変化するAI

ゲーム状況によってAIの感情を変化させる。

例：

| ゲーム状況 | 感情 | 発言例 |
|---|---|---|
| AI有利 | 自信満々 | ふふっ、勝負はもう見えましたね |
| 互角 | 冷静 | なかなかいい勝負ですね |
| AI不利 | 焦り | ちょっと待ってください！まずいですね |
| AI勝利 | 喜び | やりました！私の勝ちです！ |
| AI敗北 | 悔しさ | 今日はちょっと調子が悪かっただけです |

感情の判定はJavaScriptで行い、その結果をAzure OpenAIへのプロンプトに含める。

## 6. ハッタリAI

AIが不利な場合でも、一定確率で余裕があるふりをする機能を実装する。

例えば、AIが不利な状況で、

「ふふっ、もちろん想定どおりですよ」

などのセリフを生成する。

以下をWeb画面から変更できるようにする。

- ハッタリ機能のON/OFF
- ハッタリ発生確率（0～100%）
- AIの性格（優しい／普通／生意気）

ゲームの実際の勝敗や次の一手は変更せず、発言内容のみを変化させること。

## 7. Web画面

見やすいダッシュボード形式の画面を作成する。

必要な表示項目：

- Azure OpenAI接続状態
- マイク接続状態
- 音声認識結果
- AIの返答
- 会話履歴
- 現在のゲーム状態
- 盤面評価
- AIの感情
- ハッタリ設定
- テキスト入力欄
- 音声会話開始・停止ボタン
- エラー表示欄

デザインは、ダークブルーを基調としたモダンなUIにする。

## 8. ファイル構成

以下の構成で作成する。

```text
connect4-voice-ai/
├── server.py
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
├── static/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── audio.js
│   ├── game.js
│   └── emotion.js
└── mock/
    └── game-state.json
```

必要に応じてファイルを追加してもよい。

## 9. 起動方法

Windows PowerShellから以下のコマンドで起動できるようにする。

```powershell
python -m pip install -r requirements.txt
```

```powershell
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

ブラウザで以下にアクセスする。

```text
http://localhost:8000/index.html
```

Pythonコマンドが使えない場合は、`py`コマンドで実行する方法もREADMEに記載する。

## 10. 実装上の注意

- Azure OpenAIのRealtime APIは、旧Preview仕様とGA仕様を混同しないこと。
- リアルタイム音声認識では、`/openai/v1/realtime?intent=transcription` を使用する。
- 音声は24kHz・モノラル・PCM16形式を想定する。
- 音声認識のモデル名には`gpt-realtime-whisper`を指定する。
- `turn_detection`は指定せず、必要な発話区切り処理をアプリ側で実装する。
- チャットAPIには`/openai/v1/chat/completions`を使用する。
- APIキーはバックエンド側でのみ保持する。
- WebSocket通信をバックエンド経由で安全に中継する。
- 接続エラー、認証エラー、マイク権限エラーを画面に表示する。
- Azureへ接続できない場合でも、Mockモードで画面と感情制御を動作確認できるようにする。

なお、Azure APIの仕様は変更される可能性があるため、添付ガイドを優先しつつ、必要に応じて最新の公式ドキュメントと照合すること。

## 11. 成果物

以下を必ず出力すること。

1. 実行可能なソースコード一式
2. すべてのファイルを格納したZIPファイル
3. Windowsでのセットアップ手順
4. Azure APIキーの設定方法
5. アプリの起動方法
6. 動作確認手順
7. エラー発生時の対処方法
8. GitHubで共同開発する際の注意事項

**重要：コード例だけを回答するのではなく、実際にファイルを生成してZIPにまとめること。**

可能な範囲で構文チェック・起動テストを実施し、未検証の機能については明示すること。
