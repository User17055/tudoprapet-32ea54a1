import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { HeroCarousel } from "@/components/HeroCarousel";
import { Categories } from "@/components/Categories";
import { ProductGrid } from "@/components/ProductGrid";
import { ClubBanner } from "@/components/ClubBanner";
import { useState } from "react";

import { Footer } from "@/components/Footer";

const Index = () => {
  const [hasHeroBanners, setHasHeroBanners] = useState(true);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Categories />
        <HeroCarousel onHasBannersChange={setHasHeroBanners} />
        {!hasHeroBanners && (
          <HeroSection />
        )}

        <ProductGrid />
        <ClubBanner />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
