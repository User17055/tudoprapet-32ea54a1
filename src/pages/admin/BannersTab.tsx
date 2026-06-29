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
  desktop_image_path: string | null;
  link_url: string | null;
  sort_order: number;
  active: boolean;
  signedUrl?: string;
  desktopSignedUrl?: string;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

export default function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const mobileFileRef = useRef<HTMLInputElement>(null);
  const desktopFileRef = useRef<HTMLInputElement>(null);

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
        const [mobile, desktop] = await Promise.all([
          supabase.storage
            .from("banners")
            .createSignedUrl(b.image_path, SIGNED_URL_TTL),
          b.desktop_image_path
            ? supabase.storage
                .from("banners")
                .createSignedUrl(b.desktop_image_path, SIGNED_URL_TTL)
            : Promise.resolve({ data: null }),
        ]);

        return {
          ...b,
          signedUrl: mobile.data?.signedUrl,
          desktopSignedUrl: desktop.data?.signedUrl,
        };
      })
    );

    setBanners(withUrls);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const uploadFile = async (file: File, prefix: "mobile" | "desktop") => {
    const ext = file.name.split(".").pop();
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("banners").upload(path, file, {
      contentType: file.type,
    });

    if (error) throw error;
    return path;
  };

  const resetForm = () => {
    setLinkUrl("");
    setMobileFile(null);
    setDesktopFile(null);
    if (mobileFileRef.current) mobileFileRef.current.value = "";
    if (desktopFileRef.current) desktopFileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!mobileFile) {
      toast.error("Selecione a imagem mobile do banner.");
      return;
    }

    setUploading(true);
    try {
      const [mobilePath, desktopPath] = await Promise.all([
        uploadFile(mobileFile, "mobile"),
        desktopFile ? uploadFile(desktopFile, "desktop") : Promise.resolve(null),
      ]);

      const nextOrder = (banners[banners.length - 1]?.sort_order ?? 0) + 1;
      const { error } = await supabase.from("hero_banners").insert({
        image_path: mobilePath,
        desktop_image_path: desktopPath,
        link_url: linkUrl || null,
        sort_order: nextOrder,
      });

      if (error) throw error;

      toast.success("Banner enviado!");
      resetForm();
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (b: Banner) => {
    if (!confirm("Remover este banner?")) return;

    const paths = [b.image_path, b.desktop_image_path].filter(Boolean) as string[];
    await supabase.storage.from("banners").remove(paths);
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
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <label className="text-sm font-medium">Link (opcional)</label>
            <Input
              placeholder="/catalogo?categoria=racoes"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Imagem mobile</label>
              <Input
                ref={mobileFileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setMobileFile(e.target.files?.[0] ?? null)}
                disabled={uploading}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Recomendado: 656 x 572 px.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Imagem desktop</label>
              <Input
                ref={desktopFileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setDesktopFile(e.target.files?.[0] ?? null)}
                disabled={uploading}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Recomendado: 1790 x 600 px.
              </p>
            </div>
          </div>

          <Button onClick={handleUpload} disabled={uploading || !mobileFile}>
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Enviar banner
          </Button>
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
                <div className="grid gap-2 p-2">
                  {b.desktopSignedUrl && (
                    <img
                      src={b.desktopSignedUrl}
                      alt=""
                      width={1790}
                      height={600}
                      className="w-full aspect-[1790/600] rounded-md object-cover"
                    />
                  )}
                  {b.signedUrl && (
                    <img
                      src={b.signedUrl}
                      alt=""
                      width={656}
                      height={572}
                      className="w-full aspect-[656/572] rounded-md object-cover"
                    />
                  )}
                </div>

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
