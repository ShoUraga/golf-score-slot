/**
 * ゴルフスコア・スロット鑑定団 - 作成者用設定ファイル
 *
 * ここだけ書き換えれば、スコア・止め方・煽り文・演出のON/OFFが変えられます。
 *
 * stopType 早見表
 *   normal   : スーッと減速して目的の数字で着地（追加フィールド不要）
 *   overshoot: 目的を行き過ぎて → 戻る (パチンコ風)   …使うのは overshootCount / bounceBackCount
 *   tease    : 手前でフェイク停止 → タメ → 本停止       …使うのは teaseStops / teaseOffsetCells
 *   slowdown : 長めにじりじり減速して着地 (鑑定団タメ)  …easing を強めにするのが推奨
 *   decoy    : ★ 偽の数字で一度止まる → 本当の数字に "戻ってくる" / "進んで来る"
 *              …使うのは decoyDigit / decoyHoldMs / decoyReturn / decoyArriveMs / decoyReturnMsPerCell
 *              段階停止 (カチッカチッと刻んで偽停止に到達): decoyStepCount / decoyStepHoldMs / decoyStepMoveMs
 */
window.SLOT_CONFIG = {
  // ===== 表示まわり =====
  title: '本日のゴルフスコア発表',
  score: 133, // 0..999 にクランプ。範囲外は警告ログを出します

  // ===== 停止順 =====
  // 視覚的なリール並びは「百|十|一」固定。停止順だけがこの配列で決まります。
  // 仕様: 3桁目(百)→ 1桁目(一)→ 2桁目(十)（最後に中央の十が止まるのが鑑定団風）
  stopSequence: ['hundreds', 'ones', 'tens'],

  // ===== 各桁ごとの止め方 =====
  digits: {
    hundreds: {
      // 3桁目（百の位）= 最初に止まる
      spinDurationMs: 2500, // 共通: spin開始からの絶対時間(ms)。この時刻に停止アニメが始まる
      stopType: 'overshoot', // 'normal' | 'overshoot' | 'tease' | 'slowdown'
      overshootCount: 2, // [overshoot時のみ] 通り過ぎるセル数
      bounceBackCount: 1, // [overshoot時のみ] 戻るバウンドの追加回数
      teaseStops: 0, // [tease時のみ] フェイク停止の回数
      teaseOffsetCells: 1, // [tease時のみ] フェイクで止まる位置の目的地からのズレ
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', // 共通: 着地時のtransition曲線
      flashColor: '#ffeb3b', // 共通: 停止時の背景フラッシュ色
    },
    ones: {
      // 1桁目（一の位）= 2番目に止まる
      spinDurationMs: 4000,
      stopType: 'tease',
      overshootCount: 3, // ※stopType=teaseでは無視
      bounceBackCount: 2, // ※stopType=teaseでは無視
      teaseStops: 2,
      teaseOffsetCells: 1,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      flashColor: '#ff5722',
    },
    tens: {
      // 2桁目（十の位）= 最後の大トリ（中央リール）
      // 例えばスコア108(十の位=0)で decoyDigit=5, decoyReturn='backward' にすると
      // 「いったん5で止まる → 焦らし → 5→4→3→2→1→0 と戻ってくる」演出になる
      spinDurationMs: 6500,
      stopType: 'decoy',
      decoyDigit: 5,             // [decoy時のみ] 偽の停止位置(0..9)
      decoyHoldMs: 3000,          // [decoy時のみ] 偽位置で止まる時間（ドキドキのタメ）
      decoyReactionDelayMs: 600, // [decoy時のみ] 偽位置に着地してから "decoy" 煽り文が出るまでのタメ。0で即時表示
      decoyReturn: 'backward',   // [decoy時のみ] 'backward'(戻ってくる) | 'forward'(進んで来る)
      decoyArriveMs: 1200,       // [decoy時のみ] 偽位置までの減速時間
      decoyReturnMsPerCell: 1000, // [decoy時のみ] 戻る/進む時の1数字あたりの所要時間。大きいほどゆっくり数字が見える
      decoyWobbleMs: 700,        // [decoy時のみ] 戻り出す直前に "5でグラグラして動きそう" な振動を見せる時間。0で無効
      decoyWobbleAmpPx: 6,       // [decoy時のみ] グラグラの振幅(px)。大きすぎると数字が変わって見えるので注意 (目安: ~10px以下)
      // 着地後の "もう一個進む…？" 不安定揺れ (3に着地後、2へ進むかどうかわからない感を出す)
      decoyEndUncertaintyMs: 800,    // [decoy時のみ] 揺れフェーズ全体の時間。【0で無効＝元の挙動】
      decoyEndUncertaintyAmpPx: 28,  // [decoy時のみ] 次の数字方向に覗く振幅(px)。30程度で隣の数字が頭だけ見える感じ。【0で無効】
      // 段階停止 (カチッカチッと一文字ずつ進んでから偽停止位置に到達する演出)
      decoyStepCount: 4,         // [decoy時のみ] 偽停止までに何回ステップ停止するか。0で段階停止なし
      decoyStepHoldMs: 1000,      // [decoy時のみ] 各ステップで止まる時間
      decoyStepMoveMs: 500,      // [decoy時のみ] 次のステップへカチッと進む時間
      decoyResistHoldMs: 2000,   // [decoy時のみ] 偽停止の"直前"で枠がガタガタ震えて耐える演出の時間。0で無効
      decoyGiveInMoveMs: 1500,   // [decoy時のみ] 耐え切れずに偽停止位置へジワジワ屈する時の所要時間（大きいほどゆっくり）
      decoyResistSteps: [1, 3],  // [decoy時のみ] resist演出を入れるstepのインデックス(0-based)。
                                  //   stepCount=4, decoyDigit=5 のとき [1, 3] は digit 2 と digit 4 で踏ん張る。
                                  //   未指定なら最終stepだけ(=従来動作)。
      // 他stopTypeに切り替える時に使うフィールド（今は無視されます）
      overshootCount: 5,         // ※stopType=overshootのみ
      bounceBackCount: 3,        // ※stopType=overshootのみ
      teaseStops: 3,             // ※stopType=teaseのみ
      teaseOffsetCells: 1,       // ※stopType=teaseのみ
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      flashColor: '#e91e63',
    },
  },

  // ===== タイミング =====
  // ※ spinDurationMs は「鑑定スタート押下からの絶対時間」(その時刻に停止アニメが始まる)。
  //   前リールの停止アニメ＋betweenStopDelayMs がまだ続いていればそれを待つので、停止順は崩れません。
  betweenStopDelayMs: 800, // 桁停止と次桁停止の最小間隔
  finaleDelayMs: 1200, // 最終桁停止 → finale演出までのタメ

  // ===== 演出トグル（個別ON/OFF） =====
  effects: {
    bgFlash: true,
    reelSparkle: true,
    confetti: true,
    hypeText: true,
  },

  // ===== 煽り文 =====
  hypeMessages: {
    initial: '果たして今日のスコアは…！？',
    afterHundreds: '百の位、確定ーーッ！！次に止まるのはどれだッ…！',
    afterOnes: '一の位もキターーッ！運命の十の位は…！',
    resist: '耐えてくれーーッ…！踏ん張れーーッ…！',  // [decoy時のみ] resist演出のデフォルト煽り文 (resistMessagesで上書きされなかった時のフォールバック)
    resistMessages: [                                   // [decoy時のみ] decoyResistStepsと同じ順番で対応するresist時メッセージ。
      'セーターチャンス到来なるか…？',                   //   - 1番目の resist step (digit 2 → 3)
      '耐えてくれーーッ…！踏ん張れーーッ…！',            //   - 2番目の resist step (digit 4 → 5)
    ],
    decoy: 'ゴールデンウィークはおあずけ…', // [decoy時のみ] 偽停止のときに表示される煽り文
    return: 'おや…！？数字が動いてる…！？',  // [decoy時のみ] 偽停止 → 真の数字へ戻る/進む間に表示
    final: 'おあずけ回避ーーーッ！！！！！！🎉🎉🎉',
  },
};
