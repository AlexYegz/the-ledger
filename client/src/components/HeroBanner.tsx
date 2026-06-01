interface HeroBannerProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

export function HeroBanner({ eyebrow, title, subtitle }: HeroBannerProps) {
  return (
    <section className="hero-banner">
      <img
        className="hero-bg-img"
        src="/banner-ledger-row.png"
        alt=""
        aria-hidden="true"
      />
      <div className="hero-inner">
        {eyebrow && <div className="hero-eyebrow">{eyebrow}</div>}
        <h1 className="hero-title">{title}</h1>
        {subtitle && <div className="hero-sub">{subtitle}</div>}
      </div>
    </section>
  );
}
