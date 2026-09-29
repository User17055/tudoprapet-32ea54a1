import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { HeroCarousel } from "@/components/HeroCarousel";
import { ProductGrid } from "@/components/ProductGrid";
import { TrustBadges } from "@/components/TrustBadges";
import { useState } from "react";

import { Footer } from "@/components/Footer";

const Index = () => {
  const [hasHeroBanners, setHasHeroBanners] = useState(true);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroCarousel onHasBannersChange={setHasHeroBanners} />
        {!hasHeroBanners && (
          <HeroSection />
        )}

        <TrustBadges />
        <ProductGrid />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
