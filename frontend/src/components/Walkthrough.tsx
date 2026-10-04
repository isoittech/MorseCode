import { useEffect, useId } from 'react';
import { Joyride, type Step, type TooltipRenderProps } from 'react-joyride';
import { dotMs } from '../lib/morse';
import { Icon } from './Icon';

function TourTooltip({
  index,
  size,
  step,
  isLastStep,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  const titleId = useId();
  return (
    <section {...tooltipProps} role="dialog" className="tour-tooltip" aria-labelledby={titleId}>
      <header>
        <span className="eyebrow">
          操作ガイド · {index + 1} / {size}
        </span>
        <button {...closeProps} className="icon-button" aria-label="操作ガイドを終了">
          <Icon name="close" size={16} />
        </button>
      </header>
      <h2 id={titleId}>{step.title}</h2>
      <div className="tour-content">{step.content}</div>
      <footer>
        <button {...skipProps} className="tour-skip">
          スキップ
        </button>
        <div>
          {index > 0 && (
            <button {...backProps} className="button secondary">
              戻る
            </button>
          )}
          <button {...primaryProps} className="button primary">
            {isLastStep ? '練習を始める' : '次へ'}
          </button>
        </div>
      </footer>
    </section>
  );
}

export function Walkthrough({
  wpm,
  onEnd,
  onError,
}: {
  wpm: number;
  onEnd: () => void;
  onError: (message: string) => void;
}) {
  // Joyride's default Escape action advances a step; in this app Escape exits the guide.
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEnd();
    }
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onEnd]);

  const steps: Step[] = [
    {
      target: '[data-tour="send-menu"]',
      title: 'まずは「送信訓練」から',
      content: (
        <p>
          左のメニューで練習を選びます。送信は「打つ」、受信は「聴き取る」練習。知識・判断ドリルは選択式です。このガイドでは送信の流れを見ていきます。
        </p>
      ),
      placement: 'right',
      before: async () => {
        document
          .querySelector('[data-tour="send-menu"]')
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
    },
    {
      target: '[data-tour="mission"]',
      title: 'お題の文字を確認する',
      content: (
        <p>
          ここに並んだ文字を左から順番に送ります。まだ符号を覚えていなくても大丈夫。「符号を見る」で、点と線のお手本を表示できます。
        </p>
      ),
    },
    {
      target: '[data-tour="keyer"]',
      title: '短く押して「トン」、長く押して「ツー」',
      content: (
        <>
          <p>
            Spaceキーか画面の打鍵キーを押し続けます。今の設定では短点が約{Math.round(dotMs(wpm))}
            ms、長点がその3倍です。
          </p>
          <p>
            最初は「短点」「長点」の補助ボタンでも練習できます。ガイドを閉じると入力できるようになります。
          </p>
        </>
      ),
      placement: 'top',
    },
    {
      target: '[data-tour="monitor"]',
      title: '少し待つと、一文字が確定',
      content: (
        <>
          <p>
            手を離して約{Math.round(3 * dotMs(wpm))}
            ms待つと、点と線が文字に変わります。同じ文字の途中では、これより短い間隔で続けて打ちます。
          </p>
          <p>お題と合えば緑色に。間違えたら「入力を消去」でやり直せます。</p>
        </>
      ),
    },
    {
      target: '[data-tour="judge"]',
      title: '全部打てたら「判定する」',
      content: (
        <p>
          「判定する」を押すと正解率と打鍵の精度が表示され、訓練記録に残ります。そのあと「次の課題へ」。補助ボタンで入力した場合、押す時間の精度は採点しません。
        </p>
      ),
      placement: 'top',
    },
    {
      target: '[data-tour="coach"]',
      title: '迷ったら、コーチに聞く',
      content: (
        <>
          <p>
            「Kの打ち方を教えて」「文字が分かれてしまう」など、そのまま相談できます。入力ミスや判定後のAI講評も利用できます。
          </p>
          <p>これで準備完了。入門と操作ガイドは、メニューからいつでも見直せます。</p>
        </>
      ),
      placement: 'top',
    },
  ];
  return (
    <Joyride
      run
      continuous
      scrollToFirstStep
      steps={steps}
      tooltipComponent={TourTooltip}
      locale={{
        back: '戻る',
        close: '操作ガイドを終了',
        last: '練習を始める',
        next: '次へ',
        skip: 'スキップ',
        open: '操作ガイドを開く',
      }}
      options={{
        skipBeacon: true,
        closeButtonAction: 'skip',
        dismissKeyAction: false,
        overlayClickAction: false,
        blockTargetInteraction: true,
        buttons: ['back', 'close', 'primary', 'skip'],
        primaryColor: '#53633c',
        backgroundColor: '#f8f8f2',
        textColor: '#30362c',
        arrowColor: '#f8f8f2',
        overlayColor: '#1e281fb3',
        width: 'min(350px, calc(100vw - 32px))',
        spotlightPadding: 5,
        scrollOffset: 24,
        scrollDuration: 0,
        targetWaitTimeout: 2500,
        zIndex: 1000,
      }}
      onEvent={(event) => {
        if (event.type === 'tour:end') onEnd();
        if (event.type === 'error' || event.type === 'error:target_not_found') {
          onError(
            '操作ガイドの表示に失敗しました。メニューの「操作ガイド」からもう一度お試しください。',
          );
          onEnd();
        }
      }}
    />
  );
}
