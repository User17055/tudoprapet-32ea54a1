import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { supabase } from "@/integrations/supabase/client";
 
interface HeroBanner {
  id: string;
  image_path: string;
  link_url: string | null;
  signedUrl?: string;
  desktopSignedUrl?: string;
}

interface HeroCarouselProps {
  onHasBannersChange?: (hasBanners: boolean) => void;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 365;
const BANNER_CACHE_KEY = "hero-banners-v1";

const getDesktopPath = (mobilePath: string) =>
  mobilePath.replace(/\/mobile(\.[^.]+)$/i, "/desktop$1");

const getCachedBanners = (): HeroBanner[] => {
  if (typeof window === "undefined") return [];

  try {
    return JSON.parse(window.localStorage.getItem(BANNER_CACHE_KEY) || "[]");
  } catch {
    return [];
  }
};

const cacheBanners = (banners: HeroBanner[]) => {
  try {
    window.localStorage.setItem(BANNER_CACHE_KEY, JSON.stringify(banners));
  } catch {
    // Storage can be unavailable in private browsing; the banner still renders normally.
  }
};

const preloadImage = (src?: string) =>
  new Promise<void>((resolve) => {
    if (!src) {
      resolve();
      return;
    }

    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });

export const HeroCarousel = ({ onHasBannersChange }: HeroCarouselProps) => {
  const [banners, setBanners] = useState<HeroBanner[]>(getCachedBanners);
  const hasCachedBanners = useRef(banners.length > 0);
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" });
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("hero_banners")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });

      if (!data) {
        onHasBannersChange?.(false);
        return;
      }

      const withUrls = await Promise.all(
        data.map(async (b) => {
          const desktopPath = getDesktopPath(b.image_path);
          const [mobile, desktop] = await Promise.all([
            supabase.storage
              .from("banners")
              .createSignedUrl(b.image_path, SIGNED_URL_TTL),
            desktopPath !== b.image_path
              ? supabase.storage
                  .from("banners")
                  .createSignedUrl(desktopPath, SIGNED_URL_TTL)
              : Promise.resolve({ data: null }),
          ]);

          return {
            ...b,
            signedUrl: mobile.data?.signedUrl,
            desktopSignedUrl: desktop.data?.signedUrl,
          };
        })
      );

      const visibleBanners = withUrls.filter((b) => b.signedUrl);
      if (!hasCachedBanners.current) {
        await preloadImage(visibleBanners[0]?.desktopSignedUrl || visibleBanners[0]?.signedUrl);
      }

      setBanners(visibleBanners);
      cacheBanners(visibleBanners);
      onHasBannersChange?.(visibleBanners.length > 0);
    })();
  }, [onHasBannersChange]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIdx(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    const interval = setInterval(() => emblaApi.scrollNext(), 4500);
    return () => clearInterval(interval);
  }, [emblaApi, onSelect]);

  if (banners.length === 0) return null;

  return (
    <section className="py-3 md:py-6">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {banners.map((b, i) => {
            const content = (
              <picture>
                <source
                  media="(min-width: 768px)"
                  srcSet={b.desktopSignedUrl || b.signedUrl}
                />
                <img
                  src={b.signedUrl}
                  alt=""
                  width={656}
                  height={572}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding={i === 0 ? "sync" : "async"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  className="w-full aspect-[656/572] md:aspect-[1790/600] object-cover rounded-2xl md:rounded-3xl"
                />
              </picture>
            );

            return (
              <div
                key={b.id}
                className="flex-[0_0_92%] md:flex-[0_0_100%] min-w-0 px-2 md:px-4"
              >
                {b.link_url ? (
                  b.link_url.startsWith("http") ? (
                    <a href={b.link_url} target="_blank" rel="noreferrer">
                      {content}
                    </a>
                  ) : (
                    <Link to={b.link_url}>{content}</Link>
                  )
                ) : (
                  content
                )}
              </div>
            );
          })}
        </div>
      </div>

      {banners.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {banners.map((_, i) => (
            <button
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`Ir para banner ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === selectedIdx ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
};
