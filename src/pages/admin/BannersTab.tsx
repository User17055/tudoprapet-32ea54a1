import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface Banner {
  id: string;
  image_path: string;
  link_url: string | null;
  sort_order: number;
  active: boolean;
  signedUrl?: string;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

export default function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("hero_banners")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const withUrls = await Promise.all(
      (data || []).map(async (b) => {
        const { data: signed } = await supabase.storage
          .from("banners")
          .createSignedUrl(b.image_path, SIGNED_URL_TTL);

        return { ...b, signedUrl: signed?.signedUrl };
      })
    );

    setBanners(withUrls);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("banners")
        .upload(path, file, { contentType: file.type });

      if (upErr) throw upErr;

      const nextOrder = (banners[banners.length - 1]?.sort_order ?? 0) + 1;
      const { error: insErr } = await supabase.from("hero_banners").insert({
        image_path: path,
        link_url: linkUrl || null,
        sort_order: nextOrder,
      });

      if (insErr) throw insErr;

      toast.success("Banner enviado!");
      setLinkUrl("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (b: Banner) => {
    if (!confirm("Remover este banner?")) return;

    await supabase.storage.from("banners").remove([b.image_path]);
    await supabase.from("hero_banners").delete().eq("id", b.id);
    toast.success("Removido");
    load();
  };

  const toggleActive = async (b: Banner) => {
    await supabase.from("hero_banners").update({ active: !b.active }).eq("id", b.id);
    load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = banners[idx + dir];
    if (!target) return;

    const cur = banners[idx];
    await supabase
      .from("hero_banners")
      .update({ sort_order: target.sort_order })
      .eq("id", cur.id);
    await supabase
      .from("hero_banners")
      .update({ sort_order: cur.sort_order })
      .eq("id", target.id);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carrossel de Banners</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div>
            <label className="text-sm font-medium">Link (opcional)</label>
            <Input
              placeholder="/catalogo?categoria=racoes"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Imagem (PNG/JPG)</label>
            <Input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              disabled={uploading}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Recomendado para desktop: 1790 x 600 px. No mobile, a mesma arte
              sera enquadrada em 656 x 572 px.
            </p>
          </div>

          {uploading && (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
            </div>
          )}
        </div>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : banners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum banner cadastrado ainda.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {banners.map((b, i) => (
              <div
                key={b.id}
                className={`relative overflow-hidden rounded-lg border bg-card ${
                  !b.active ? "opacity-50" : ""
                }`}
              >
                {b.signedUrl && (
                  <div className="grid gap-2 p-2">
                    <img
                      src={b.signedUrl}
                      alt=""
                      width={1790}
                      height={600}
                      className="w-full aspect-[1790/600] rounded-md object-cover"
                    />
                    <img
                      src={b.signedUrl}
                      alt=""
                      width={656}
                      height={572}
                      className="w-full aspect-[656/572] rounded-md object-cover md:hidden"
                    />
                  </div>
                )}

                <div className="p-2 text-xs">
                  {b.link_url && (
                    <p className="mb-1 truncate text-muted-foreground">
                      -&gt; {b.link_url}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(i, 1)}
                      disabled={i === banners.length - 1}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(b)}>
                      {b.active ? (
                        <Eye className="h-3.5 w-3.5" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(b)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
