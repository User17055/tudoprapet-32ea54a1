import { Header } from "@/components/Header";
import { HeroCarousel } from "@/components/HeroCarousel";
import { Categories } from "@/components/Categories";
import { ProductGrid } from "@/components/ProductGrid";
import { ClubBanner } from "@/components/ClubBanner";

import { Footer } from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Mobile: carrossel de banners gerenciado pelo admin */}
        <div className="md:hidden">
          <HeroCarousel />
        </div>
        {/* Desktop: hero tradicional */}
        <div className="hidden md:block">
          <HeroSection />
        </div>
        <Categories />

        <ProductGrid />
        <ClubBanner />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
