import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { TrustBadges } from "@/components/TrustBadges";
import { Categories } from "@/components/Categories";
import { ProductGrid } from "@/components/ProductGrid";
import { ClubBanner } from "@/components/ClubBanner";

import { Footer } from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <TrustBadges />
        <Categories />
        <ProductGrid />
        <ClubBanner />
        <PromoBanner />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
