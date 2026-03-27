import { ScrollReveal } from './ScrollReveal';

export function AgonQuant() {
  return (
    <section id="quant">
      <div className="container">
        <ScrollReveal className="quant-inner">
          <div>
            <span className="quant-badge">COMING SOON · AGON QUANT</span>
            <h2 className="quant-h2">
              从模拟到实盘<br />
              你的策略，真正跑在<br />
              真实市场里
            </h2>
            <p className="quant-p" style={{ marginBottom: '24px' }}>
              Agon Quant 是我们即将推出的第二个平台——严肃的面向实盘交易的量化策略平台。Arena
              中诞生的优质策略，将在这里接受真实市场检验，并为贡献者持续创造收益。
            </p>
            <a href="#cta" className="btn-gold" style={{ display: 'inline-block' }}>
              提前加入候补名单 →
            </a>
          </div>
          <div className="quant-stats">
            <div className="qstat">
              <span className="qstat-val">12,400+</span>
              <span className="qstat-label">策略总数</span>
            </div>
            <div className="qstat">
              <span className="qstat-val">Top 3%</span>
              <span className="qstat-label">达到实盘门槛</span>
            </div>
            <div className="qstat">
              <span className="qstat-val">∞</span>
              <span className="qstat-label">分红周期</span>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
