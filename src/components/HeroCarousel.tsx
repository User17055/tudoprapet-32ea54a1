import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { supabase } from "@/integrations/supabase/client";

interface Banner {
  id: string;
  image_path: string;
  link_url: string | null;
  signedUrl?: string;
}

export const HeroCarousel = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" });
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("hero_banners")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (!data) return;
      const withUrls = await Promise.all(
        data.map(async (b) => {
          const { data: signed } = await supabase.storage
            .from("banners")
            .createSignedUrl(b.image_path, 60 * 60 * 24 * 365);
          return { ...b, signedUrl: signed?.signedUrl };
        })
      );
      setBanners(withUrls.filter((b) => b.signedUrl));
    })();
  }, []);

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
    <section className="py-3">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {banners.map((b) => {
            const content = (
              <img
                src={b.signedUrl}
                alt=""
                className="w-full aspect-square object-cover rounded-2xl"
              />
            );
            return (
              <div key={b.id} className="flex-[0_0_92%] min-w-0 px-2">
                {b.link_url ? (
                  b.link_url.startsWith("http") ? (
                    <a href={b.link_url} target="_blank" rel="noreferrer">{content}</a>
                  ) : (
                    <Link to={b.link_url}>{content}</Link>
                  )
                ) : content}
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
