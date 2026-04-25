/* ゴルフスコア・スロット鑑定団 - コアロジック */
(() => {
  const CELLS_PER_LOOP = 10;
  const SPIN_SPEED_CELLS_PER_SEC = 36; // ベース回転速度

  // ====== State ======
  const state = {
    spinning: false,
    finished: false,
    cfg: null,
    score: 0,
    digits: { hundreds: 0, tens: 0, ones: 0 },
    reels: new Map(), // place -> Reel
  };

  // ====== Utils ======
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function clampScore(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > 999) {
      console.warn(
        `[golf-score-slot] score=${raw} は 0..999 の整数でなければなりません。クランプします。`,
      );
    }
    return Math.max(0, Math.min(999, Number.isFinite(n) ? n : 0));
  }

  function splitDigits(score) {
    return {
      hundreds: Math.floor(score / 100) % 10,
      tens: Math.floor(score / 10) % 10,
      ones: score % 10,
    };
  }

  function getCellPx(rootEl) {
    const v = getComputedStyle(rootEl).getPropertyValue('--cell').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 96;
  }

  function maxBufferCells(cfg) {
    let maxOver = 0;
    let maxTease = 0;
    let maxStep = 0;
    let hasDecoy = false;
    for (const place of Object.keys(cfg.digits)) {
      const d = cfg.digits[place];
      if (d.stopType === 'overshoot') {
        maxOver = Math.max(maxOver, d.overshootCount | 0);
      } else if (d.stopType === 'tease') {
        maxTease = Math.max(maxTease, (d.teaseStops | 0) * CELLS_PER_LOOP);
      } else if (d.stopType === 'decoy') {
        hasDecoy = true;
        maxStep = Math.max(maxStep, d.decoyStepCount | 0);
      }
    }
    // baseline: baseTargetY uses 1 loop ahead.
    // decoy: 偽停止に3ループ目、forward復帰に最大4ループ目まで使うので4ループ確保。
    // overshoot: target を行き過ぎる分。
    // tease: フェイク停止1回ごとに1ループ進める。
    // decoyStep: 偽停止前の段階停止 (decoyY から最大 stepCount セル手前から始める)
    const baseLoops = hasDecoy ? 4 : 2;
    return CELLS_PER_LOOP * baseLoops + maxOver + maxTease + maxStep + 12;
  }

  // ====== Reel ======
  class Reel {
    constructor(rootEl, place) {
      this.root = rootEl;
      this.windowEl = rootEl.querySelector('.reel-window');
      this.strip = rootEl.querySelector('.strip');
      this.place = place;
      this.indexFloat = 0; // 初期表示は "0" 揃え (cell[0] が窓の中央)
      this.cellPx = getCellPx(rootEl);
      this.raf = null;
      this.lastT = null;
    }

    build(totalCells) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < totalCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = String(i % 10);
        frag.appendChild(cell);
      }
      this.strip.innerHTML = '';
      this.strip.appendChild(frag);
      this.applyTransform(this.indexFloat * this.cellPx);
    }

    applyTransform(yPx) {
      this.strip.style.transform = `translate3d(0, ${-yPx}px, 0)`;
    }

    startSpin() {
      if (this.raf) return;
      this.lastT = null;
      const tick = (t) => {
        if (this.lastT == null) this.lastT = t;
        const dt = (t - this.lastT) / 1000;
        this.lastT = t;
        this.indexFloat =
          (this.indexFloat + SPIN_SPEED_CELLS_PER_SEC * dt) % CELLS_PER_LOOP;
        this.applyTransform(this.indexFloat * this.cellPx);
        this.raf = requestAnimationFrame(tick);
      };
      this.strip.style.transition = 'none';
      this.raf = requestAnimationFrame(tick);
    }

    /** rAF を止め、現在Yを transition なしで確定して返す */
    freeze() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.lastT = null;
      const y = (this.indexFloat % CELLS_PER_LOOP) * this.cellPx;
      this.strip.style.transition = 'none';
      this.applyTransform(y);
      // 強制リフロー（次の transition を効かせるため）
      void this.strip.offsetHeight;
      return y;
    }

    /** transform を transition で動かす */
    moveTo(yPx, durationMs, easing) {
      return new Promise((resolve) => {
        if (durationMs <= 0) {
          this.strip.style.transition = 'none';
          this.applyTransform(yPx);
          void this.strip.offsetHeight;
          resolve();
          return;
        }
        this.strip.style.transition = `transform ${durationMs}ms ${easing || 'ease-out'}`;
        let done = false;
        const onEnd = (e) => {
          if (e.propertyName !== 'transform') return;
          if (done) return;
          done = true;
          this.strip.removeEventListener('transitionend', onEnd);
          resolve();
        };
        this.strip.addEventListener('transitionend', onEnd);
        // 次フレームで適用すると確実に transition が走る
        requestAnimationFrame(() => this.applyTransform(yPx));
        // セーフティタイマ（transitionend 取りこぼし対策）
        setTimeout(() => {
          if (done) return;
          done = true;
          this.strip.removeEventListener('transitionend', onEnd);
          resolve();
        }, durationMs + 250);
      });
    }

    /**
     * 動き出し直前の "ぐらぐら" 演出。
     * centerY を中心にストリップ自体を ±ampPx の正弦波で揺らす（数字は変わらない範囲）
     */
    wobble(centerY, durationMs, ampPx) {
      return new Promise((resolve) => {
        if (durationMs <= 0 || ampPx <= 0) { resolve(); return; }
        this.strip.style.transition = 'none';
        const t0 = performance.now();
        let raf;
        const tick = () => {
          const elapsed = performance.now() - t0;
          if (elapsed >= durationMs) {
            this.applyTransform(centerY);
            cancelAnimationFrame(raf);
            resolve();
            return;
          }
          // 約 7Hz の正弦波振動 (period = 140ms)
          const phase = (elapsed / 70) * Math.PI;
          const offset = Math.sin(phase) * ampPx;
          this.applyTransform(centerY + offset);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      });
    }
  }

  // ====== Stop animations (per stopType) ======
  async function stopReel(reel, targetDigit, dcfg) {
    reel.freeze();
    const cell = reel.cellPx;
    // 着地は必ず "1ループ先" の同じ数字位置にする = 必ず前進する
    let baseTargetY = CELLS_PER_LOOP * cell + targetDigit * cell;
    const easing = dcfg.easing || 'cubic-bezier(0.16, 1, 0.3, 1)';

    switch (dcfg.stopType) {
      case 'normal':
        await reel.moveTo(baseTargetY, 700, easing);
        break;

      case 'overshoot': {
        const overshoot = Math.max(0, dcfg.overshootCount | 0);
        const bounces = Math.max(0, dcfg.bounceBackCount | 0);
        const overY = baseTargetY + overshoot * cell;
        // 1) 行き過ぎる
        await reel.moveTo(overY, 800, easing);
        // 2) 戻ってきて目標に着地（overshoot=0 なら no-op）
        if (overshoot > 0) {
          await reel.moveTo(baseTargetY, 320, 'cubic-bezier(.34,1.56,.64,1)');
        }
        // 3) 減衰バウンド
        let amp = cell * 0.55;
        for (let i = 0; i < bounces; i++) {
          await reel.moveTo(baseTargetY - amp, 170, 'ease-out');
          await reel.moveTo(baseTargetY, 170, 'ease-in');
          amp *= 0.5;
        }
        break;
      }

      case 'tease': {
        const stops = Math.max(0, dcfg.teaseStops | 0);
        const offset = Math.max(1, (dcfg.teaseOffsetCells | 0) || 1) * cell;
        // フェイク停止を繰り返す。1回ごとに「もう一周回って戻ってくる」演出にする
        let target = baseTargetY;
        for (let i = 0; i < stops; i++) {
          // 目的の手前(=offset 分手前)にスーッと寄せて止まる
          await reel.moveTo(target - offset, 600 + i * 80, 'cubic-bezier(.2,.85,.2,1)');
          await wait(380);
          // ガクッと吸い込まれる風に少し戻ってから前進
          await reel.moveTo(target - offset - cell * 0.25, 100, 'ease-in');
          // 「もう一周」回しながら次の停止候補へ進む
          target += CELLS_PER_LOOP * cell;
          await reel.moveTo(target - offset * 1.5, 700, 'cubic-bezier(.2,.85,.2,1)');
        }
        // 最終本停止
        await reel.moveTo(target, 700, easing);
        break;
      }

      case 'slowdown': {
        const slowEasing = dcfg.easing || 'cubic-bezier(.05,.7,.1,1)';
        await reel.moveTo(baseTargetY, 1500, slowEasing);
        break;
      }

      case 'decoy': {
        // 偽の数字で一度止まり → 本当の数字に "戻ってくる" / "進んで来る" 演出
        const decoyDigit = Math.max(0, Math.min(9, dcfg.decoyDigit | 0));
        const holdMs = Math.max(0, dcfg.decoyHoldMs | 0);
        const dir = dcfg.decoyReturn === 'forward' ? 'forward' : 'backward';
        const arriveMs = Math.max(400, dcfg.decoyArriveMs | 0 || 1100);
        // 段階停止（カチッカチッと一文字ずつ進む）
        const stepCount = Math.max(0, dcfg.decoyStepCount | 0);
        const stepHoldMs = Math.max(0, (dcfg.decoyStepHoldMs | 0) || 350);
        const stepMoveMs = Math.max(50, (dcfg.decoyStepMoveMs | 0) || 220);
        // 偽停止直前の "耐えてる" 演出 (0で無効、最終ステップだけ適用)
        const resistHoldMs = Math.max(0, dcfg.decoyResistHoldMs | 0);
        // 耐え切れず偽停止位置へ屈する時の所要時間 (大きいほどジワジワ進む)
        const giveInMoveMs = Math.max(50, (dcfg.decoyGiveInMoveMs | 0) || 1500);

        // 偽停止位置: 3ループ目に置く（前段の段階停止と forward 復帰のための余裕を確保）
        const decoyY = 3 * CELLS_PER_LOOP * cell + decoyDigit * cell;

        if (stepCount > 0) {
          // resist 演出を入れる step インデックスのSet。
          // config 未指定なら最終ステップだけ (=従来動作)。
          const resistStepsRaw = Array.isArray(dcfg.decoyResistSteps)
            ? dcfg.decoyResistSteps
            : [stepCount - 1];
          const resistSteps = new Set(
            resistStepsRaw.filter(
              (n) => Number.isInteger(n) && n >= 0 && n < stepCount,
            ),
          );

          // 段階停止: 偽停止位置の手前 (decoyDigit - stepCount) から1セルずつ刻んで decoyY へ
          const firstStepY = decoyY - stepCount * cell;
          // まず最初のステップ位置までスーッと減速
          await reel.moveTo(firstStepY, arriveMs, easing);
          // 各ステップで止まって → 軽くシェイク → 1セル進む を繰り返す
          for (let i = 0; i < stepCount; i++) {
            const doResist = resistSteps.has(i) && resistHoldMs > 0;
            if (doResist) {
              // 偽停止の直前: ガタガタ震えて "耐えてる" 風 → ジワジワ屈して偽停止位置へ
              reel.root.classList.remove('is-shake');
              void reel.root.offsetWidth;
              reel.root.classList.add('is-resist');
              // "耐えてくれ…ッ" 系の煽り文に切り替え
              if (state.cfg.effects.hypeText) {
                const resistMsg = state.cfg.hypeMessages.resist;
                if (resistMsg) setHype(resistMsg);
              }
              await wait(resistHoldMs);
              reel.root.classList.remove('is-resist');
              // 耐えきれずジワジワ偽停止位置へ屈する (S字カーブで徐々に → 諦め → 着地)
              await reel.moveTo(
                firstStepY + (i + 1) * cell,
                giveInMoveMs,
                'cubic-bezier(.6,.05,.4,1)',
              );
            } else {
              // 通常ステップ: 静かに止まって → 軽くシェイク → 1セル進む
              await wait(stepHoldMs);
              reel.root.classList.remove('is-shake');
              void reel.root.offsetWidth;
              reel.root.classList.add('is-shake');
              await reel.moveTo(
                firstStepY + (i + 1) * cell,
                stepMoveMs,
                'cubic-bezier(.2,.9,.3,1)',
              );
            }
          }
          // ループ終了時点で decoyY に到達済み
        } else {
          // 段階停止なし: 従来通り一発で偽停止位置まで減速
          await reel.moveTo(decoyY, arriveMs, easing);
        }

        // 偽停止のリアクション: ピクッと震える (着地のインパクトはすぐ)
        reel.root.classList.remove('is-shake');
        void reel.root.offsetWidth;
        reel.root.classList.add('is-shake');

        // "5 が止まってから" decoy 煽り文を出すためのタメ。
        // この間は resist メッセージが残ったまま → 視聴者が「5で止まった」を認識する余白
        const reactionDelay = Math.max(0, dcfg.decoyReactionDelayMs | 0);
        if (reactionDelay > 0) await wait(reactionDelay);

        // 偽停止での煽り（最終桁のときのみ差し替え。途中桁なら fireStopEffects に任せる）
        if (state.cfg.effects.hypeText) {
          const hypeMsg = state.cfg.hypeMessages.decoy;
          if (hypeMsg) setHype(hypeMsg);
        }

        await wait(holdMs);

        // 戻り(または進み)開始の煽り: "おや…！？" 系で「あれ確定じゃない…？」と気づかせる
        if (state.cfg.effects.hypeText) {
          const returnMsg = state.cfg.hypeMessages.return;
          if (returnMsg) setHype(returnMsg);
        }

        // 本当の数字へ移動
        let finalY;
        if (dir === 'backward') {
          // 戻ってくる: Y を減少させる (decoyY と同ループ or 前ループの targetDigit)
          finalY =
            (targetDigit < decoyDigit ? 3 : 2) * CELLS_PER_LOOP * cell +
            targetDigit * cell;
        } else {
          // 進んで来る: Y を増加させる (decoyY と同ループ or 次ループの targetDigit)
          finalY =
            (targetDigit > decoyDigit ? 3 : 4) * CELLS_PER_LOOP * cell +
            targetDigit * cell;
        }

        const distCells = Math.abs(finalY - decoyY) / cell;
        // 中間の数字がちゃんと見える長さに（1セルあたり~200ms 確保）
        const dur = Math.max(
          900,
          Math.min(2400, 300 + distCells * (dcfg.decoyReturnMsPerCell | 0 || 200)),
        );
        const returnEasing =
          dir === 'backward'
            // 戻る: ぐっと戻ってジワッと数字に近づく（中間数字がしっかり見える）
            ? 'cubic-bezier(.2,.65,.35,1)'
            : 'cubic-bezier(.16,1,.3,1)';

        // ★ 激アツ演出: burst 発動 → 5の位置でグラグラ (動き出しそう感) → 戻り → 着地
        reel.root.classList.remove('is-shake', 'is-resist');
        void reel.root.offsetWidth;
        reel.root.classList.add('is-burst');

        // 動き出し前: 5に居座ったまま枠が震え、ストリップも微振動 ("動きそう…！")
        const wobbleMs = Math.max(0, dcfg.decoyWobbleMs | 0);
        const wobbleAmpPx = Math.max(0, (dcfg.decoyWobbleAmpPx | 0) || 6);
        if (wobbleMs > 0 && wobbleAmpPx > 0) {
          await reel.wobble(decoyY, wobbleMs, wobbleAmpPx);
        }

        // ぐらぐら → 本当の数字へ動き出す
        await reel.moveTo(finalY, dur, returnEasing);

        // 着地で激アツ解除 → ピクッと一発インパクトのシェイクで締める
        reel.root.classList.remove('is-burst');
        void reel.root.offsetWidth;
        reel.root.classList.add('is-shake');
        break;
      }

      default:
        console.warn(`[golf-score-slot] 未知の stopType: ${dcfg.stopType} → 'normal' で処理`);
        await reel.moveTo(baseTargetY, 700, easing);
    }
  }

  // ====== Effects ======
  const els = {};

  function setHype(text, isFinal = false) {
    if (!state.cfg.effects.hypeText) return;
    els.hype.textContent = text;
    els.hype.classList.toggle('is-final', isFinal);
    // アニメーション再発火
    els.hype.style.animation = 'none';
    void els.hype.offsetWidth;
    els.hype.style.animation = '';
  }

  function flashBg(color, mega = false) {
    if (!state.cfg.effects.bgFlash) return;
    els.bgFlash.style.background = color || '#fff';
    els.bgFlash.classList.remove('is-flash', 'is-mega');
    void els.bgFlash.offsetWidth;
    els.bgFlash.classList.add(mega ? 'is-mega' : 'is-flash');
  }

  function sparkReel(reelEl) {
    if (!state.cfg.effects.reelSparkle) return;
    reelEl.classList.remove('is-spark', 'is-shake');
    void reelEl.offsetWidth;
    reelEl.classList.add('is-spark', 'is-shake');
  }

  function fireStopEffects(place) {
    const reel = state.reels.get(place);
    const dcfg = state.cfg.digits[place];
    flashBg(dcfg.flashColor, false);
    sparkReel(reel.root);
    const messages = state.cfg.hypeMessages;
    const hypeMap = {
      hundreds: messages.afterHundreds,
      ones: messages.afterOnes,
      tens: messages.afterOnes, // tens が中で止まるケース、最終以外なら一応
    };
    // ただし最終桁のときは finale に任せるので差し替えない
    const lastIdx = state.cfg.stopSequence.length - 1;
    const isLast = state.cfg.stopSequence[lastIdx] === place;
    if (!isLast && hypeMap[place]) setHype(hypeMap[place]);
  }

  function spawnConfetti() {
    if (!state.cfg.effects.confetti) return;
    const colors = [
      '#ffeb3b', '#ff5722', '#e91e63', '#4caf50',
      '#03a9f4', '#9c27b0', '#ffffff', '#ffd76a',
    ];
    const count = Math.min(120, Math.max(40, Math.floor(window.innerWidth / 4)));
    const layer = els.confetti;
    layer.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      const startX = Math.random() * 100; // vw
      const drift = (Math.random() * 60 - 30) + 'vw';
      const rot = (300 + Math.random() * 720) + 'deg';
      const dur = 2.4 + Math.random() * 2.4;
      const delay = Math.random() * 0.6;
      c.style.left = `${startX}vw`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', drift);
      c.style.setProperty('--rot', rot);
      c.style.animationDuration = `${dur}s`;
      c.style.animationDelay = `${delay}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      frag.appendChild(c);
    }
    layer.appendChild(frag);
    // クリーンアップ
    setTimeout(() => {
      layer.innerHTML = '';
    }, 6000);
  }

  // ====== Sequencing ======
  async function start() {
    if (state.spinning) return;
    state.spinning = true;
    els.start.disabled = true;
    els.reset.hidden = true;
    setHype(state.cfg.hypeMessages.initial);

    // 全リール回転開始
    for (const reel of state.reels.values()) reel.startSpin();

    // spinDurationMs は「spin 開始からの絶対時間」。
    // 前のリールの停止アニメ＋betweenStopDelay がまだ続いていればそれを待つ（停止順は維持される）
    const seq = state.cfg.stopSequence;
    const t0 = performance.now();
    const between = Math.max(0, state.cfg.betweenStopDelayMs | 0);
    let prevDoneAt = 0; // t0からの経過ms

    for (let i = 0; i < seq.length; i++) {
      const place = seq[i];
      const dcfg = state.cfg.digits[place];
      const earliestNext = i === 0 ? 0 : prevDoneAt + between;
      const targetStartAt = Math.max(dcfg.spinDurationMs | 0, earliestNext);
      const elapsed = performance.now() - t0;
      const waitMs = Math.max(0, targetStartAt - elapsed);
      if (waitMs > 0) await wait(waitMs);

      const reel = state.reels.get(place);
      const digit = state.digits[place];
      await stopReel(reel, digit, dcfg);
      fireStopEffects(place);
      prevDoneAt = performance.now() - t0;
    }

    // フィナーレ
    await wait(Math.max(0, state.cfg.finaleDelayMs | 0));
    finale();
  }

  function finale() {
    state.finished = true;
    state.spinning = false;
    setHype(state.cfg.hypeMessages.final, true);
    flashBg('#fff7d4', true);
    spawnConfetti();
    // スコア全体を脈動
    const reelsEl = document.getElementById('reels');
    reelsEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)' },
        { transform: 'scale(1)' },
        { transform: 'scale(1.04)' },
        { transform: 'scale(1)' },
      ],
      { duration: 900, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    );
    els.start.hidden = true;
    els.reset.hidden = false;
  }

  function reset() {
    state.spinning = false;
    state.finished = false;
    // リール位置を 0 に戻す
    for (const reel of state.reels.values()) {
      reel.indexFloat = 0;
      reel.strip.style.transition = 'none';
      reel.applyTransform(0);
    }
    setHype(state.cfg.hypeMessages.initial);
    els.bgFlash.classList.remove('is-flash', 'is-mega');
    els.confetti.innerHTML = '';
    els.start.hidden = false;
    els.start.disabled = false;
    els.reset.hidden = true;
  }

  // ====== Init ======
  function init() {
    if (!window.SLOT_CONFIG) {
      console.error('[golf-score-slot] window.SLOT_CONFIG が見つかりません。config.js を読み込んでください。');
      return;
    }
    state.cfg = window.SLOT_CONFIG;

    // タイトル差し込み
    if (state.cfg.title) {
      document.title = state.cfg.title;
      const titleEl = document.getElementById('title');
      if (titleEl) titleEl.textContent = state.cfg.title;
    }

    state.score = clampScore(state.cfg.score);
    state.digits = splitDigits(state.score);

    // DOM 参照
    els.hype = document.getElementById('hype');
    els.start = document.getElementById('start');
    els.reset = document.getElementById('reset');
    els.bgFlash = document.getElementById('bgFlash');
    els.confetti = document.getElementById('confetti');

    // リール初期化
    const totalCells = maxBufferCells(state.cfg);
    document.querySelectorAll('.reel').forEach((reelEl) => {
      const place = reelEl.dataset.place;
      const reel = new Reel(reelEl, place);
      reel.build(totalCells);
      state.reels.set(place, reel);
    });

    // 初期煽り文
    setHype(state.cfg.hypeMessages.initial);

    // ボタン配線
    els.start.addEventListener('click', () => {
      if (!state.spinning && !state.finished) start();
    });
    els.reset.addEventListener('click', reset);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
