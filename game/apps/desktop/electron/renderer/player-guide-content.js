(function (root) {
  "use strict";

  const content = {
    "zh-CN": {
      eyebrow: "新玩家教程", title: "先认识你的冒险", start: "开始教程", skip: "暂时跳过", close: "关闭",
      previous: "上一步", next: "下一步", finish: "完成教程", details: "展开说明", progress: "第 {current} / {total} 步",
      review: "查看新玩家教程", reset: "重置教程提示", help: "打开 DeepSeek 入门帮助",
      prompt: "准备好时，花两分钟认识连接、开局和保存方式。不会自动开始冒险。", deepSeekTitle: "DeepSeek 入门", deepSeekLead: "这是一份本地说明；官方按钮只在你主动点击时打开浏览器。", deepSeekButton: "查看本地 DeepSeek 注册帮助", deepSeekProgress: "DeepSeek 入门说明", backToTutorial: "返回玩家教程", openConnection: "打开模型连接设置", openAudio: "打开声音与语音设置", resetDone: "已恢复入门教程与游戏界面引导提示。", saveFailed: "无法保存教程进度，请稍后重试。", readFailed: "无法读取教程进度。", linkFailed: "无法打开帮助链接，请稍后重试。", stepsLabel: "教程步骤",
      deepSeekSteps: [
        { id: "what", title: "了解 API 与费用", lead: "API 是游戏向模型请求故事的接口；API Key 是授权密钥，不是登录密码。", details: ["联网故事和连接测试按服务商用量计费，本地教程不计费。"], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek 平台" }] },
        { id: "register", title: "注册或登录", lead: "打开官网 platform.deepseek.com；已有账号登录，没有账号点“立即注册”，按当前页面支持的邮箱或手机号方式注册。", details: ["若页面提供邮箱注册：填写邮箱，再设定并再次输入密码。", "点发送验证码，到邮箱取码并填回页面。", "阅读协议后注册并登录。", "没收到验证码时检查地址和垃圾箱，再按页面提示重试；地区和按钮会变，以官网为准。"], helpLinks: [{ id: "deepseek-platform", label: "官方注册入口" }] },
        { id: "key", title: "创建并保管密钥", lead: "登录后打开 API Keys 页面新建密钥，可命名为“灰鸦测试”。", details: ["复制完整值后妥善保存；未保留或怀疑泄露时，到官网删除并重建。不要把密钥发到群组或截图。"], helpLinks: [{ id: "deepseek-keys", label: "管理 API 密钥" }] },
        { id: "balance", title: "查看余额和用量", lead: "在官网查看账户余额和用量，余额不足时才按需充值。", details: ["能网页登录不等于 API 余额充足；价格和可用额度以官网当前显示为准。"], helpLinks: [{ id: "deepseek-billing", label: "打开充值页面" }, { id: "deepseek-pricing", label: "官方定价参考" }] },
        { id: "grey-crow", title: "回到灰鸦连接", lead: "在设置 → 模型连接选择内置 DeepSeek／默认 Flash，粘贴 API Key 后点“测试并使用”。", details: ["连接成功后返回主菜单：第一次游玩选“新游戏”；已有冒险想保留进度，选“继续当前冒险”。内置 DeepSeek 无需填写接口地址。"], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek 官方入口" }] },
        { id: "errors", title: "处理常见失败", lead: "401 检查密钥；402 检查余额；429 或服务繁忙时稍后再试；网络错误检查连接。", details: ["403 表示服务拒绝了请求；请核对平台权限或联系服务商。官方参考核对日期：2026-09-20。"], helpLinks: [{ id: "deepseek-errors", label: "官方错误说明" }] }
      ],
      steps: [
        { id: "connection", title: "连接模型", lead: "先到“设置 → 模型连接”配置并测试要使用的服务。", details: ["选择内置服务时只需粘贴 API Key；新手不必填写接口地址。", "“测试并使用”会发送少量请求，可能产生费用；通过只表示现在可以连接，故事质量和后续可用性仍取决于服务。"] },
        { id: "start", title: "开始与剧本", lead: "在主菜单选择“新游戏”，选择剧本、阅读简介，校验后确认创建。", details: ["随后与灰鸦用对话确认身份、唯一之物和起点，再进入正式冒险。", "有进行中冒险时，新游戏会先要求确认删除；想继续原故事请选“继续当前冒险”。教程不会开始新游戏或删除存档。"] },
        { id: "action", title: "用自然语言行动", lead: "在输入框写角色现在想做什么，例如“问店主今天有没有见过她”或“沿河观察脚印”。", details: ["Enter 提交本轮；Shift+Enter 换行。每次提交是一轮行动尝试，不保证成功。", "根据结果继续追问、调整或换一种做法。"] },
        { id: "interface", title: "阅读界面", lead: "进入冒险后，会有遮罩逐项指出状态栏、右侧面板和输入区；可随时跳过，或在设置中“重看游戏界面引导”。", details: ["右上角会显示等待、停止或出错状态；等待时可停止本轮，出错后查看提示再决定下一步。", "小窗口也能使用：必要时滚动页面，先阅读本轮结果再输入下一步。"] },
        { id: "voice", title: "语音、朗读与内存", lead: "在“设置 → 声音与语音”开启语音输入后，输入框内按住说话、松开后识别；先手动校正文字，再自行发送行动。", details: ["先确认设置中识别模型已就绪，再点“试录”检查麦克风；系统询问时允许录音。资源缺失时按提示处理，仍可继续打字。", "单次录音最长两分钟，也可用输入区麦克风按钮开始和结束。识别不会自动发送行动。", "想听故事：将“朗读故事”设为“点按朗读”，点击正文段末的 > 按钮；设为“自动朗读”后，新回复会自动播放。首次加载模型可能需要等待，可先在设置中“试听”。", "识别进程在 Mac 可参考约 0.6–0.7GB 内存，游戏与朗读另计；实际用量随设备和运行状态变化。不需要时可关闭语音。"] },
        { id: "save", title: "保存、回顾与问题报告", lead: "每轮剧情完成后自动保存，无须按保存按钮；可从目录或章节入口查看章节回顾。", details: ["想定期整理回顾，可在“设置 → 存档与内容”开启“定期生成章节回顾”并选择频率。回顾生成会使用模型；关闭回顾不影响每轮自动存档。", "遇到问题，从设置底部“导出问题报告”保存文件，并另外说明刚才做了什么。报告不包含密钥、正文或录音，也不会自动上传；另附截图时请遮住私人信息。"] }
      ]
    },
    "en-US": {
      eyebrow: "New-player guide", title: "Meet your adventure", start: "Start guide", skip: "Skip for now", close: "Close",
      previous: "Back", next: "Next", finish: "Finish", details: "Details", progress: "Step {current} of {total}",
      review: "View new-player guide", reset: "Reset tutorial prompts", help: "Open DeepSeek getting started",
      prompt: "When ready, spend two minutes on connection, starting, and saving. This will not start an adventure.", deepSeekTitle: "DeepSeek getting started", deepSeekLead: "This is a local guide. Official buttons open a browser only when you choose them.", deepSeekButton: "Open local DeepSeek registration help", deepSeekProgress: "DeepSeek getting started", backToTutorial: "Back to player guide", openConnection: "Open model connection settings", openAudio: "Open sound and voice settings", resetDone: "The entry guide and game interface tour will appear again.", saveFailed: "Tutorial progress could not be saved. Try again later.", readFailed: "Tutorial progress could not be read.", linkFailed: "The help link could not be opened. Try again later.", stepsLabel: "Guide steps",
      deepSeekSteps: [
        { id: "what", title: "Understand API and charges", lead: "An API lets the game request a story from a model. An API Key authorizes it; it is not a sign-in password.", details: ["Online stories and connection tests are billed by the provider. This local guide is free."], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek platform" }] },
        { id: "register", title: "Register or sign in", lead: "Open platform.deepseek.com. Sign in if you have an account; otherwise choose Register now and follow the email or phone option currently offered.", details: ["If email registration is offered, enter your email, then set and confirm a password.", "Send a verification code, retrieve it from your email, and enter it on the page.", "Read the agreement, register, then sign in.", "If the code is missing, check the address and spam folder, then follow the page to retry. Region and buttons may change, so follow the site."], helpLinks: [{ id: "deepseek-platform", label: "Official registration" }] },
        { id: "key", title: "Create and protect a key", lead: "After signing in, open API Keys and create one; you may name it Grey Crow test.", details: ["Copy the complete value and keep it safe. Delete and recreate it on the website if it was lost or may be exposed. Never post or screenshot it."], helpLinks: [{ id: "deepseek-keys", label: "Manage API keys" }] },
        { id: "balance", title: "Check balance and usage", lead: "Check account balance and usage on the site; add funds only when needed.", details: ["Being able to sign in does not prove API balance. Check the current prices and available credit on the official site."], helpLinks: [{ id: "deepseek-billing", label: "Open top-up page" }, { id: "deepseek-pricing", label: "Official pricing" }] },
        { id: "grey-crow", title: "Connect in Grey Crow", lead: "In Settings → Model connection choose built-in DeepSeek/default Flash, paste the API Key, then choose Test and use.", details: ["After a successful test, return to the main menu. Choose New Game for your first adventure, or Continue current adventure to keep an existing story. Built-in DeepSeek needs no endpoint address."], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek official site" }] },
        { id: "errors", title: "Handle common failures", lead: "For 401 check the key; 402 the balance; 429 or a busy service wait and retry; for network errors check connectivity.", details: ["403 only means the service refused the request: check platform permission or contact the provider. Official references checked 2026-09-20."], helpLinks: [{ id: "deepseek-errors", label: "Official error help" }] }
      ],
      steps: [
        { id: "connection", title: "Connect a model", lead: "Use Settings → Model connection to configure and test the service you choose.", details: ["For a built-in service, paste only the API Key; new players do not need an endpoint address.", "Test and use sends a small request and may cost money. Passing only confirms the connection now; story quality and future availability still depend on the service."] },
        { id: "start", title: "Start and choose a scenario", lead: "Choose New Game on the main menu, choose a scenario, read its introduction, validate it, then confirm creation.", details: ["Grey Crow then confirms your identity, unique item, and starting point in conversation before the adventure begins.", "With an active adventure, New Game first asks to confirm deletion. Use Continue current adventure to keep playing; this guide never starts a game or deletes a save."] },
        { id: "action", title: "Act in natural language", lead: "Write what your character wants now, such as “Ask the shopkeeper who saw her today” or “Follow the footprints by the river.”", details: ["Enter submits a turn; Shift+Enter makes a new line. Each submission is an attempted action, never a guarantee of success.", "Ask, adapt, or try another approach after the result."] },
        { id: "interface", title: "Read the interface", lead: "Inside an adventure, a spotlight tour points out the status bar, side panels, and input area. Skip anytime, or choose Review game interface tour in Settings.", details: ["The top-right state shows waiting, stop, or error. While waiting you can stop the turn; after an error, read the guidance before deciding what to do next.", "In a small window, scroll if needed, read the result, then enter the next action."] },
        { id: "voice", title: "Voice, readout, and memory", lead: "In Settings → Sound and voice, enable voice input, hold inside the input box to speak, then release to recognize. Correct the text yourself, then send the action.", details: ["Check that the recognition model is ready in Settings, then use Test recording to check the microphone. Allow recording when the system asks. Follow any missing-resource message; typing remains available.", "Each recording lasts up to two minutes. The microphone button beside the input also starts and stops recording. Recognition never sends an action automatically.", "To hear the story, select on-demand readout and click > at the end of a story paragraph. Automatic readout plays new replies. The first model load may take time; use the preview in Settings to try it first.", "On Mac, recognition may use about 0.6–0.7GB RAM, with game and readout usage additional. Actual use varies by device and runtime. Turn voice off when you do not need it."] },
        { id: "save", title: "Save, recap, and report", lead: "A completed story turn saves automatically; no Save button is needed. Find chapter recaps from the table of contents or chapter entry.", details: ["For regular recaps, enable chapter recaps and choose a frequency in Settings → Saves and content. Generating a recap uses the model. Turning recaps off does not disable automatic story saves.", "Export a problem report at the bottom of Settings and describe what you were doing separately. The report excludes keys, story text and recordings, and is never uploaded automatically. Hide private information in any extra screenshots."] }
      ]
    },
    "ja-JP": {
      eyebrow: "はじめてのガイド", title: "冒険を始める前に", start: "ガイドを始める", skip: "今はスキップ", close: "閉じる",
      previous: "戻る", next: "次へ", finish: "ガイドを完了", details: "詳しく見る", progress: "{total} ステップ中 {current}",
      review: "はじめてのガイドを見る", reset: "ガイド表示をリセット", help: "DeepSeek 入門を開く",
      prompt: "準備ができたら、接続・開始・保存を二分ほどで確認できます。冒険は自動で始まりません。", deepSeekTitle: "DeepSeek 入門", deepSeekLead: "これはローカルの案内です。公式ボタンは自分で選んだ時だけブラウザを開きます。", deepSeekButton: "ローカルの DeepSeek 登録案内を見る", deepSeekProgress: "DeepSeek 入門案内", backToTutorial: "プレイヤーガイドへ戻る", openConnection: "モデル接続設定を開く", openAudio: "サウンドと音声の設定を開く", resetDone: "入門とゲーム画面のガイド表示を戻しました。", saveFailed: "ガイドの進行状況を保存できませんでした。後でもう一度試してください。", readFailed: "ガイドの進行状況を読み取れませんでした。", linkFailed: "ヘルプリンクを開けませんでした。後でもう一度試してください。", stepsLabel: "ガイドの手順",
      deepSeekSteps: [
        { id: "what", title: "API と料金を知る", lead: "API はゲームがモデルへ物語を依頼する窓口です。API Key は認証用の鍵で、ログイン用パスワードではありません。", details: ["オンラインの物語と接続確認は提供元の従量課金です。このローカルガイドは無料です。"], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek プラットフォーム" }] },
        { id: "register", title: "登録またはログイン", lead: "公式サイト platform.deepseek.com を開きます。アカウントがあればログインし、なければ「今すぐ登録」から、その時点で表示されるメールまたは電話の方法に従います。", details: ["メール登録が表示される場合は、メールを入力し、パスワードを設定して確認します。", "認証コードを送信し、メールから取得して画面に入力します。", "規約を読み、登録後にログインします。", "届かない時はアドレスや迷惑メールを確認して画面案内に従い再試行します。地域やボタンは変わるため公式画面を優先します。"], helpLinks: [{ id: "deepseek-platform", label: "公式登録入口" }] },
        { id: "key", title: "キーを作成して保管", lead: "ログイン後に API Keys を開いてキーを作成します。名前は「灰鸦テスト」でも構いません。", details: ["完全な値をコピーして安全に保管します。紛失・漏えいの疑いがあれば公式サイトで削除して作り直し、共有やスクリーンショットをしません。"], helpLinks: [{ id: "deepseek-keys", label: "API キーの管理" }] },
        { id: "balance", title: "残高と利用量を確認", lead: "公式サイトでアカウント残高と利用量を確認し、必要な時だけ入金します。", details: ["ログインできても API 残高が十分とは限りません。現在の料金と利用可能な残高は公式サイトで確認してください。"], helpLinks: [{ id: "deepseek-billing", label: "入金ページを開く" }, { id: "deepseek-pricing", label: "公式料金案内" }] },
        { id: "grey-crow", title: "灰鸦で接続する", lead: "設定 → モデル接続で内蔵 DeepSeek／既定 Flash を選び、API Key を貼って「テストして使用」を選びます。", details: ["接続に成功したらメインメニューに戻ります。初めてなら新しいゲーム、進行中の物語を残して遊ぶなら現在の冒険を続けるを選びます。内蔵 DeepSeek の接続先 URL は入力不要です。"], helpLinks: [{ id: "deepseek-platform", label: "DeepSeek 公式入口" }] },
        { id: "errors", title: "よくある失敗を処理", lead: "401 はキー、402 は残高、429／混雑は待って再試行、ネットワークエラーは接続を確認します。", details: ["403 はサービス拒否を示すだけです。プラットフォーム権限を確認するか提供元へ問い合わせます。公式参考の確認日：2026-09-20。"], helpLinks: [{ id: "deepseek-errors", label: "公式エラー案内" }] }
      ],
      steps: [
        { id: "connection", title: "モデルを接続する", lead: "「設定 → モデル接続」で利用するサービスを設定し、接続を確認します。", details: ["内蔵サービスでは API Key を貼るだけです。新規プレイヤーは URL を入力する必要がありません。", "「テストして使用」は少量のリクエストを送るため費用が発生することがあります。成功は現在の接続確認であり、物語の品質や今後の可用性はサービスに依存します。"] },
        { id: "start", title: "開始とシナリオ", lead: "メインメニューで「新しいゲーム」を選び、シナリオを選択して紹介を読み、検証後に作成を確認します。", details: ["その後、灰鸦との会話で身元、唯一の持ち物、出発点を確認してから正式な冒険が始まります。", "進行中の冒険がある時、新しいゲームは先に削除確認を求めます。続ける時は「現在の冒険を続ける」を選びます。ガイドはゲーム開始や保存削除をしません。"] },
        { id: "action", title: "自然な言葉で行動する", lead: "「店主に今日彼女を見たか聞く」「川沿いの足跡を観察する」など、今したいことを入力します。", details: ["Enter でターンを送信し、Shift+Enter で改行します。送信は一つの行動の試行で、成功は保証されません。", "結果を見て質問、調整、別の方法を試せます。"] },
        { id: "interface", title: "画面を読む", lead: "冒険に入ると、画面ガイドが状態表示、右のパネル、入力欄を順に強調します。スキップもでき、設定の「ゲーム画面ガイドを見る」で再確認できます。", details: ["右上には待機、停止、エラーの状態が表示されます。待機中はターンを停止でき、エラー後は案内を読んでから次を決めます。", "小さなウィンドウでは必要に応じてスクロールし、結果を読んでから次を入力します。"] },
        { id: "voice", title: "音声、読み上げ、メモリ", lead: "「設定 → サウンドと音声」で音声入力を有効にし、入力欄を長押しして話し、離すと認識します。文字を自分で直してから行動を送ります。", details: ["設定で認識モデルの準備ができていることを確認し、テスト録音でマイクを試します。システムから確認されたら録音を許可します。リソース不足の案内が出ても文字入力は続けられます。", "一回の録音は最長二分です。入力欄のマイクボタンでも録音を開始・終了できます。認識結果が行動として自動送信されることはありません。", "物語を聞くには手動の読み上げを選び、本文の段落末の > を押します。自動にすると新しい返答が再生されます。初回のモデル読込には時間がかかることがあるので、設定で試聴できます。", "Mac では認識に約 0.6–0.7GB RAM を使う場合があります。ゲームと読み上げは別に加わり、端末や実行状態で変わります。不要なら音声を無効にできます。"] },
        { id: "save", title: "保存、回顧、問題報告", lead: "物語のターン完了時に自動保存され、保存ボタンは不要です。章の回顧は目次または章の入口から見ます。", details: ["定期的な振り返りが必要なら「設定 → セーブと内容」で章の振り返りを有効にし、頻度を選びます。生成にはモデルを使います。無効にしても毎ターンの自動保存は続きます。", "問題が起きたら設定の下部から問題レポートを保存し、直前の操作を別に説明してください。レポートにはキー、物語の本文、録音は含まれず、自動送信もされません。別添の画像では個人情報を隠してください。"] }
      ]
    }
  };

  function validateContent(candidate = content) {
    const locales = ["zh-CN", "en-US", "ja-JP"];
    const sharedKeys = ["eyebrow", "title", "start", "skip", "close", "previous", "next", "finish", "details", "progress", "review", "reset", "help", "prompt", "deepSeekTitle", "deepSeekLead", "deepSeekButton", "deepSeekProgress", "backToTutorial", "openConnection", "openAudio", "resetDone", "saveFailed", "readFailed", "linkFailed", "stepsLabel"];
    for (const locale of locales) {
      const entry = candidate[locale];
      if (!entry || sharedKeys.some((key) => typeof entry[key] !== "string" || !entry[key].trim())) return false;
      if (!Array.isArray(entry.steps) || entry.steps.length !== 6) return false;
      if (entry.steps.some((step) => !step.id || !step.title || !step.lead || !Array.isArray(step.details) || !step.details.length)) return false;
      if (!Array.isArray(entry.deepSeekSteps) || entry.deepSeekSteps.length !== 6) return false;
      if (entry.deepSeekSteps.some((step) => !step.id || !step.title || !step.lead || !Array.isArray(step.details) || !step.details.length
        || (step.helpLinks && step.helpLinks.some((link) => !link.id || !link.label)))) return false;
    }
    return true;
  }

  root.GreyCrowPlayerGuideContent = Object.freeze({ content, validateContent });
}(globalThis));
