# Connect Four Voice AI

Connect Four の盤面状況に応じて感情や口調を変えながら会話する、Windows向けローカルWebアプリです。FastAPIでAzure OpenAIへの通信を中継し、ブラウザーにはAPIキーを送りません。フロントエンドは素のHTML・CSS・JavaScriptです。

## 主な機能

- ブラウザーのマイク音声を24kHz・モノラル・PCM16で取得し、ローカルWebSocket経由でAzure Realtime STTへ中継
- 無音を検出して発話を確定し、日本語の認識結果を表示
- Azure Chat Completionsのストリーミング応答と会話履歴
- ブラウザー標準のSpeechSynthesisによる読み上げ。読み上げ中はマイク音声を送信しません
- 盤面評価、相手の脅威、ターン、終了結果、AIの候補列を画面から変更
- JavaScriptで感情と数値ベクトルを算出し、チャットプロンプトに反映
- 不利なときに確率で余裕を装うハッタリ設定と性格設定
- Azureの認証情報なしで画面と会話を試せるMockモード

Mockモードの音声認識は定型文を返します。音声デバイス、音声区切り、画面、チャット、感情制御の確認用で、実際の音声内容を認識するものではありません。

## ファイル構成

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

## Windowsでのセットアップ

PowerShellで、このフォルダーへ移動して実行します。

    python -m pip install -r requirements.txt

python コマンドが使えない場合は、Python Launcherで実行できます。

    py -m pip install -r requirements.txt

仮想環境は必須ではありません。複数のPythonプロジェクトで依存関係を分けたい場合は、任意で仮想環境を作成してください。

## Azure APIキーと環境変数

1. .env.example をコピーして、同じフォルダーに .env を作成します。

       Copy-Item .env.example .env

2. .env をテキストエディターで開き、Azureリソースで作成したキーを AZURE_OPENAI_API_KEY に設定します。キーはこのPCの .env にだけ保存し、GitHubへコミットしないでください。

3. AzureリソースのEndpointと、実際にデプロイしたモデル名を確認します。設定例は以下です。

       AI_PROVIDER=azure
       AZURE_OPENAI_ENDPOINT=https://talkingai-openai2.openai.azure.com/
       AZURE_OPENAI_API_KEY=ここにローカルのキーを設定
       AZURE_CHAT_DEPLOYMENT=gpt-6-luna
       AZURE_REALTIME_STT_DEPLOYMENT=gpt-realtime-whisper
       AZURE_BATCH_STT_DEPLOYMENT=gpt-transcribe

.env.example のキーは空欄です。キーの値をHTML、JavaScript、ブラウザーのリクエストURLに設定しないでください。API通信はFastAPIサーバーからAzureへ行い、RealtimeのAPIキーはサーバー間WebSocketのヘッダーで送ります。

モデル名はAzure上のデプロイ名と一致させてください。利用できるモデル・デプロイ名はAzureリソースやリージョンによって異なります。指定のデプロイ名がリソースに存在しない場合は、.env の名前を実際の値に合わせます。AZURE_BATCH_STT_DEPLOYMENT は将来のバッチ認識向け設定で、このサンプルでは未使用です。

## 起動

このフォルダーで次を実行します。

    python -m uvicorn server:app --host 127.0.0.1 --port 8000

Python Launcherを使う場合:

    py -m uvicorn server:app --host 127.0.0.1 --port 8000

ブラウザーで開きます。

    http://localhost:8000/index.html

サーバーを止めるには、PowerShellで Ctrl+C を押します。マイクは localhost でブラウザーの許可ダイアログを承認してください。

## 動作確認

1. Azureキーを設定せず起動し、画面上部のモードがMockになっていることを確認します。
2. ターン、盤面評価、相手の脅威、AIの候補列を操作し、感情ラベルとベクトルが変わることを確認します。
3. AI不利を選んでハッタリをONにし、確率を上げてテキスト会話を数回試します。発生は確率によるため、毎回同じ結果にはなりません。
4. 終了状態にし、結果をAI勝利／AI敗北／引き分けに変更して感情が切り替わることを確認します。
5. マイクを許可して「音声会話を開始」を押します。Mockでは定型の認識文が会話欄へ送られます。読み上げのON/OFFも試せます。
6. Azureを試す場合は、.env に有効なキーとデプロイ名を設定し、画面の接続モードをAzure OpenAIに切り替えます。テキスト会話と音声会話は別々に接続を確認します。Health表示は設定の有無を示し、実接続済み表示は最初の応答後に切り替わります。

Azureへの実接続は、利用者のキー・デプロイ・リージョン・ネットワークが必要なため、この配布物のローカル確認では行っていません。

## ゲームロジックとの接続

現状は mock/game-state.json を初期値として読み込み、画面上の操作をフロントエンドのゲーム状態として管理します。ゲーム班のJavaScriptからは次のように状態を渡せます。

    window.Connect4Game.setState({
      event: "robot_turn_started",
      turn: "robot",
      game_status: "playing",
      advantage: "losing",
      previous_advantage: "even",
      opponent_threat: true,
      robot_move_column: 4,
      winner: null
    });

状態変更時には connect4:state カスタムイベントも発火します。現時点では実ゲームのREST APIやゲーム班のWebSocketには接続していません。将来の通信処理はゲーム状態モジュール（static/game.js）に追加できます。

ゲームの勝敗やロボットの実際の手はこのアプリから変更しません。候補列は発言の文脈に渡すだけです。感情ベクトルは演出用の0〜100の値で、感情や心理状態を測定・診断するものではありません。

## トラブルシューティング

- マイクが使えない: http://localhost:8000/index.html で開き、サイトのマイク権限を許可します。OS側のマイクプライバシー設定や、他アプリがマイクを占有していないかも確認してください。
- マイク状態が接続中のまま: PowerShellのUvicornエラーを確認し、サーバーを再起動します。別ポートで起動した場合はURLも合わせてください。
- Azure未設定と表示される: .env が server.py と同じフォルダーにあるか、キーとデプロイ名に空欄や余分な引用符がないかを確認します。値を変更した後はサーバーを再起動してください。
- Azure 401/403: APIキー、リソースEndpoint、キーの対象リソース、認証方式と権限を確認します。
- Azure 404 / deployment not found: デプロイが存在し、チャットとRealtimeで指定した各モデルに対応するかを確認して .env を修正します。モデルの基盤名と、Azureで設定したデプロイ名を混同しないでください。
- Realtimeだけ失敗する: 対象のAzureリソースでRealtime transcriptionを使えること、AZURE_REALTIME_STT_DEPLOYMENT が有効なデプロイ名であること、FirewallやプロキシがWebSocketを妨げていないことを確認します。
- 応答がない、または遅い: ネットワーク、Azureのクォータ・レート制限、デプロイ状態を確認します。まずMockで画面とマイク許可を切り分けます。
- 読み上げの声が違う: SpeechSynthesisの日本語音声はブラウザーとWindowsにインストールされた音声に依存します。

## GitHubで共同開発する際の注意

- .env とAPIキーをコミットしないでください。.gitignore に .env を登録していますが、共有前に git status とコミット内容を確認してください。
- 誤ってキーを公開した場合は、Azureでそのキーを無効化・再生成します。
- 共有する .env.example にはキーや個人情報を入れないでください。
- ゲームロジック班は static/game.js の状態形式を共有し、受け渡しJSONのフィールド名と値をそろえてください。
- 依存パッケージの変更は requirements.txt に反映し、PRでは接続設定や変更したモジュールを説明してください。
- .env の変更をGitで追跡する必要はありません。開発者ごとにローカル設定します。

## API仕様メモ

Realtime音声認識はAzure Realtime APIの /openai/v1/realtime?intent=transcription に、サーバーからAPIキーをヘッダーで渡して接続します。Realtimeガイドのtranscriptionセッション形式に合わせて24kHz PCMと認識モデルを設定します。発話区切りはブラウザー側の無音検出で決め、確定時にbuffer commitを送ります。チャットは /openai/v1/chat/completions のストリーミングを使います。

最新の公式資料:

- [Microsoft Learn: GPT Realtime APIをWebSocketsで使う](https://learn.microsoft.com/azure/foundry/openai/how-to/realtime-audio-websockets)
- [Microsoft Learn: Azure OpenAI Chat Completions REST API](https://learn.microsoft.com/azure/foundry/openai/latest)

Azure側のAPI仕様、リージョン、モデル提供状況は更新されるため、接続時にAzureの公式資料とお使いのリソース設定も確認してください。
