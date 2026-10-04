import { useEffect, useRef, useState } from 'react';
import { useKeyer } from '../hooks/useKeyer';
import { errorMessage } from '../lib/api';
import { ALPHABET, codeFor, displayCode, MorseAudio } from '../lib/morse';
import { Icon } from './Icon';

const LETTERS = ['E', 'T', 'A'] as const;
const RHYTHMS: Record<(typeof LETTERS)[number], string> = { E: 'トン', T: 'ツー', A: 'トン・ツー' };
const INTRO_WPM = 5;

function FirstKey({ letter, onNext }: { letter: (typeof LETTERS)[number]; onNext: () => void }) {
  const [audio] = useState(() => new MorseAudio());
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const keyer = useKeyer(INTRO_WPM, !playing && !finished, audio);
  const correct = keyer.decoded === letter;
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => {
    if (keyer.groups.length) setFinished(true);
  }, [keyer.groups.length]);

  function reset() {
    audio.stop();
    setPlaying(false);
    keyer.reset();
    setFinished(false);
    setError('');
  }
  async function listen() {
    reset();
    setPlaying(true);
    try {
      await audio.play([ALPHABET[letter]], INTRO_WPM, () => setPlaying(false));
    } catch (e) {
      setError(errorMessage(e));
      setPlaying(false);
    }
  }
  const signal = keyer.groups.length ? codeFor(keyer.groups[0], INTRO_WPM) : keyer.currentCode;
  return (
    <div className="first-key">
      <div className="first-key-target">
        <div className="intro-letter">
          <b>{letter}</b>
          <span>{displayCode(ALPHABET[letter])}</span>
        </div>
        <div>
          <h3>「{letter}」を打ってみよう</h3>
          <p>
            {letter === 'E'
              ? '短く一回、トンと押して離します。'
              : letter === 'T'
                ? 'Eの3倍くらい長く、ツーと押して離します。'
                : '短く、長く。二つの音を続けて打ちます。'}
          </p>
          <button
            className="intro-listen"
            onClick={() => void listen()}
            disabled={playing || keyer.down}
          >
            <Icon name="sound" size={15} />
            {playing ? '再生中…' : `${letter}のお手本を聴く`}
          </button>
        </div>
      </div>
      <button
        data-keyer="true"
        className={`key-pad intro-key ${keyer.down ? 'pressed' : ''}`}
        aria-label="入門の打鍵キー"
        disabled={playing || finished}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          keyer.press();
        }}
        onPointerUp={keyer.release}
        onPointerCancel={keyer.cancel}
        onLostPointerCapture={keyer.cancel}
      >
        <span className="key-contact" />
        <b>{keyer.down ? '音を送っています' : 'ここを押して、離す'}</b>
        <span>Spaceキーでも入力できます</span>
      </button>
      <div className="intro-key-hint">
        <span>短く：約0.24秒</span>
        <span>長く：約0.72秒</span>
        <span>離して約0.72秒で一文字に</span>
      </div>
      <div
        className={`intro-feedback ${finished ? (correct ? 'correct' : 'retry') : ''}`}
        role="status"
      >
        <span className="intro-decoded">{keyer.decoded || displayCode(signal) || '…'}</span>
        <p>
          {keyer.notice ||
            (finished
              ? correct
                ? `できました！ ${RHYTHMS[letter]}が「${letter}」になりました。`
                : `今の入力は「${keyer.decoded === '�' ? '未登録の符号' : keyer.decoded}」でした。${letter === 'A' ? 'トンとツーの間を短くして、続けて打ってみましょう。' : letter === 'E' ? 'もう少し短く押してみましょう。' : 'もう少し長く押してみましょう。'}`
              : keyer.down
                ? '押している長さが、そのまま音の長さになります。'
                : signal
                  ? '手を離したまま待つと、文字が確定します。'
                  : 'お手本を聴いて、同じリズムで押してみましょう。')}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="intro-practice-actions">
        <button className="button secondary" onClick={reset}>
          <Icon name="reset" size={14} />
          もう一度
        </button>
        {correct && finished && (
          <button className="button primary" onClick={onNext}>
            {letter === 'A' ? '画面の使い方へ' : `次は「${letter === 'E' ? 'T' : 'A'}」`}
            <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
      <details className="intro-assist">
        <summary>長く押す操作が難しいときは</summary>
        <p>補助ボタンを使えば、一回のクリックで短点・長点を入力できます。</p>
        <div>
          <button
            className="button secondary"
            disabled={playing || finished}
            onClick={() => keyer.paddle('.')}
            aria-label="入門で短点を入力"
          >
            · 短点
          </button>
          <button
            className="button secondary"
            disabled={playing || finished}
            onClick={() => keyer.paddle('-')}
            aria-label="入門で長点を入力"
          >
            − 長点
          </button>
        </div>
      </details>
    </div>
  );
}

export function Introduction({
  firstVisit,
  onTour,
  onSkip,
  busy,
}: {
  firstVisit: boolean;
  onTour: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const [step, setStep] = useState(0);
  const [letterIndex, setLetterIndex] = useState(0);
  const [audio] = useState(() => new MorseAudio());
  const [playing, setPlaying] = useState('');
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => audio.dispose(), [audio]);

  function changeStep(next: number) {
    audio.stop();
    setPlaying('');
    setError('');
    setStep(next);
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  async function listen(letter: string) {
    setError('');
    setPlaying(letter);
    try {
      await audio.play([ALPHABET[letter]], INTRO_WPM, () => setPlaying(''));
    } catch (e) {
      setError(errorMessage(e));
      setPlaying('');
    }
  }
  return (
    <div className="introduction">
      <div className="section-title">
        <div>
          <span className="eyebrow">FIRST CONTACT / はじめてのモールス</span>
          <h1 ref={heading} tabIndex={-1}>
            モールス信号とは？
          </h1>
          <p>
            {firstVisit
              ? 'ようこそ。知識ゼロから、最初の一文字まで。'
              : '音を聴いて、打って、基本を確かめよう。'}
          </p>
        </div>
        <span className="tag">約3分</span>
      </div>
      <nav className="intro-steps" aria-label="入門のステップ">
        {['知る・聴く', '一文字打つ', '画面に慣れる'].map((label, index) => (
          <button
            key={label}
            aria-current={step === index ? 'step' : undefined}
            onClick={() => changeStep(index)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {label}
          </button>
        ))}
      </nav>
      <section
        className="intro-lesson"
        aria-label={['モールスの基本', '一文字の練習', '訓練の始め方'][step]}
      >
        {step === 0 ? (
          <>
            <div className="intro-copy">
              <h2>短い音と長い音で、文字を伝える。</h2>
              <p>
                モールス信号は、短い信号「<b>トン（短点）</b>」と長い信号「<b>ツー（長点）</b>
                」の組み合わせで文字を表す通信方法です。音だけでなく、光の点滅でも伝えられます。
              </p>
              <p>
                このアプリでは、英字・数字などを表す<b>国際モールス</b>
                を練習します。まずはこの3文字。ボタンを押して、音の違いを聴いてみましょう。
              </p>
            </div>
            <div className="intro-sounds">
              {LETTERS.map((letter) => (
                <button
                  key={letter}
                  onClick={() => void listen(letter)}
                  disabled={!!playing}
                  className={playing === letter ? 'playing' : ''}
                  aria-label={`${letter}のお手本を聴く`}
                >
                  <b>{letter}</b>
                  <span className="intro-code">{displayCode(ALPHABET[letter])}</span>
                  <span>{RHYTHMS[letter]}</span>
                  <small>
                    <Icon name="sound" size={13} />
                    {playing === letter ? '再生中' : '音を聴く'}
                  </small>
                </button>
              ))}
            </div>
            <div className="intro-rhythm">
              <h3>長さと「間」が、読み分けの鍵。</h3>
              <div>
                <span>短点</span>
                <i className="rhythm-dot" />
                <b>1拍</b>
              </div>
              <div>
                <span>長点</span>
                <i className="rhythm-dash" />
                <b>3拍</b>
              </div>
              <p>
                同じ文字の中では<b>1拍</b>の間。文字と文字の間は<b>3拍</b>、単語の間は<b>7拍</b>
                空けます。間を空けすぎると、別の文字として伝わります。
              </p>
            </div>
            <div className="intro-lesson-footer">
              <span>全部を暗記する必要はありません。</span>
              <button className="button primary" onClick={() => changeStep(1)}>
                一文字打ってみる
                <Icon name="arrow" size={15} />
              </button>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <div className="intro-practice-heading">
              <span className="eyebrow">TRY IT / {letterIndex + 1} OF 3</span>
              <span className="tag">成績には残りません</span>
            </div>
            <FirstKey
              key={letterIndex}
              letter={LETTERS[letterIndex]}
              onNext={() => {
                if (letterIndex < LETTERS.length - 1) setLetterIndex(letterIndex + 1);
                else changeStep(2);
              }}
            />
            <p className="intro-footnote">
              入門はゆっくりの5
              WPM。WPMは速さの目安で、数値を下げるほど打つ時間・待つ時間が長くなります。
            </p>
          </>
        ) : (
          <>
            <div className="intro-copy">
              <h2>次は、実際の訓練画面へ。</h2>
              <p>
                送信訓練は、<b>お題を見る → 符号を打つ → 判定する</b>
                の3つで進みます。覚えていない文字は「符号を見る」で確認できます。
              </p>
            </div>
            <div className="intro-modes">
              <div>
                <Icon name="send" />
                <div>
                  <b>送信訓練</b>
                  <p>文字を見て、同じ符号を打つ。</p>
                </div>
                <span className="tag">まずはここ</span>
              </div>
              <div>
                <Icon name="receive" />
                <div>
                  <b>受信訓練</b>
                  <p>音を聴いて、文字を答える。</p>
                </div>
              </div>
              <div>
                <Icon name="book" />
                <div>
                  <b>知識・判断ドリル</b>
                  <p>符号の決まりと対応を、選択問題で学ぶ。</p>
                </div>
              </div>
              <div>
                <Icon name="chat" />
                <div>
                  <b>AIコーチ</b>
                  <p>分からないことを、自分の言葉で質問する。</p>
                </div>
              </div>
            </div>
            <div className="intro-tip">
              <Icon name="settings" size={17} />
              <p>速いと感じたら「訓練設定」で5 WPMに下げてみましょう。入門と同じ速度になります。</p>
            </div>
            <button className="button primary intro-start-tour" onClick={onTour} disabled={busy}>
              操作ガイドを始める
              <Icon name="arrow" size={16} />
            </button>
            <p className="intro-footnote">6つのポイントを、実際の画面で順に案内します。</p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="intro-shortcuts">
        {step !== 2 && (
          <button onClick={onTour} disabled={busy}>
            操作ガイドへ進む
            <Icon name="chevron" size={13} />
          </button>
        )}
        <button onClick={onSkip} disabled={busy}>
          {firstVisit ? '入門をスキップして訓練へ' : '送信訓練へ戻る'}
          <Icon name="chevron" size={13} />
        </button>
      </div>
      <p className="intro-replay-note">入門と操作ガイドは、メニューからいつでも開けます。</p>
    </div>
  );
}
