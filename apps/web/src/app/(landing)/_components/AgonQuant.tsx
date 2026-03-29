'use client';
import { ScrollReveal } from './ScrollReveal';
import { useLang } from '@/lib/useLang';

const copy = {
  en: {
    h2: <>From simulation to live markets<br />your strategy, running on<br />real capital</>,
    p: 'Agon Quant is our second platform — a serious live-trading quant strategy marketplace. The best strategies born in Arena will face real market validation here, generating ongoing revenue for contributors.',
    cta: 'Join the waitlist →',
    s1: 'Strategies',
    s2: 'Live-ready threshold',
    s3: 'Dividend cycles',
  },
  zh: {
    h2: <>从模拟到实盘<br />你的策略，真正跑在<br />真实市场里</>,
    p: 'Agon Quant 是我们即将推出的第二个平台——严肃的面向实盘交易的量化策略平台。Arena 中诞生的优质策略，将在这里接受真实市场检验，并为贡献者持续创造收益。',
    cta: '提前加入候补名单 →',
    s1: '策略总数',
    s2: '达到实盘门槛',
    s3: '分红周期',
  },
};

export function AgonQuant() {
  const [lang] = useLang();
  const t = copy[lang];

  return (
    <section id="quant">
      <div className="container">
        <ScrollReveal className="quant-inner">
          <div>
            <span className="quant-badge">COMING SOON · AGON QUANT</span>
            <h2 className="quant-h2">{t.h2}</h2>
            <p className="quant-p" style={{ marginBottom: '24px' }}>{t.p}</p>
            <a href="#cta" className="btn-gold" style={{ display: 'inline-block' }}>
              {t.cta}
            </a>
          </div>
          <div className="quant-stats">
            <div className="qstat">
              <span className="qstat-val">12,400+</span>
              <span className="qstat-label">{t.s1}</span>
            </div>
            <div className="qstat">
              <span className="qstat-val">Top 3%</span>
              <span className="qstat-label">{t.s2}</span>
            </div>
            <div className="qstat">
              <span className="qstat-val">∞</span>
              <span className="qstat-label">{t.s3}</span>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
