import { AgonQuant } from './_components/AgonQuant';
import { ArenaShowcase } from './_components/ArenaShowcase';
import { CtaSection } from './_components/CtaSection';
import { DataAssets } from './_components/DataAssets';
import { HeroSection } from './_components/HeroSection';
import { HowItWorks } from './_components/HowItWorks';

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <HowItWorks />
      <ArenaShowcase />
      <DataAssets />
      <AgonQuant />
      <CtaSection />
    </>
  );
}
