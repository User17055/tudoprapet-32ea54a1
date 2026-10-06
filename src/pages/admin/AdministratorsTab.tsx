import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRowsResult } from "@/lib/fetchAllRows";

interface ProfileRow {
  user_id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

interface AdminRow extends ProfileRow {
  roleId: string;
  grantedAt: string;
}

export default function AdministratorsTab() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<AdminRow | null>(null);

  const load = async () => {
    setLoading(true);
    const [profileResult, roleResult] = await Promise.all([
      fetchAllRowsResult<{ user_id: string; name: string | null; email: string | null; created_at: string }>(
        "profiles",
        "user_id,name,email,created_at",
        { orderBy: ["name", "user_id"] },
      ),
      fetchAllRowsResult<{ id: string; user_id: string; created_at: string }>("user_roles", "id,user_id,created_at", {
        orderBy: ["created_at", "id"],
        filter: (query) => query.eq("role", "admin"),
      }),
    ]);
    if (profileResult.error || roleResult.error) {
      toast.error("Não foi possível carregar os administradores", {
        description: profileResult.error?.message || roleResult.error?.message,
      });
    }
    const profileRows = (profileResult.data || []) as ProfileRow[];
    setProfiles(profileRows);
    const byUser = new Map(profileRows.map((profile) => [profile.user_id, profile]));
    setAdmins((roleResult.data || []).map((role) => ({
      ...(byUser.get(role.user_id) || {
        user_id: role.user_id,
        name: null,
        email: null,
        created_at: role.created_at,
      }),
      roleId: role.id,
      grantedAt: role.created_at,
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addAdministrator = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    const profile = profiles.find((item) => item.email?.toLowerCase() === normalizedEmail);
    if (!profile) {
      toast.error("Conta não encontrada", {
        description: "A pessoa precisa criar uma conta na loja antes de receber acesso administrativo.",
      });
      return;
    }
    if (admins.some((admin) => admin.user_id === profile.user_id)) {
      toast.info("Esta conta já é administradora.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: profile.user_id, role: "admin" });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível conceder o acesso", { description: error.message });
      return;
    }
    toast.success("Administrador cadastrado", { description: `${normalizedEmail} já pode acessar o painel.` });
    setEmail("");
    await load();
  };

  const confirmRemoval = async () => {
    if (!removing || removing.user_id === user?.id || admins.length <= 1) return;
    const target = removing;
    setRemoving(null);
    const { error } = await supabase.from("user_roles").delete().eq("id", target.roleId).eq("role", "admin");
    if (error) {
      toast.error("Não foi possível remover o acesso", { description: error.message });
      return;
    }
    toast.success("Acesso administrativo removido");
    await load();
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return admins;
    return admins.filter((admin) =>
      (admin.name || "").toLowerCase().includes(query) ||
      (admin.email || "").toLowerCase().includes(query));
  }, [admins, search]);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <UserPlus className="h-5 w-5" />
          </span>
          <CardTitle className="text-lg">Cadastrar administrador</CardTitle>
          <CardDescription>
            Conceda acesso a uma conta que já esteja cadastrada na loja.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="admin-email" className="mb-1.5 block text-sm font-semibold">E-mail da conta</label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void addAdministrator(); }}
              placeholder="admin@exemplo.com"
            />
          </div>
          <Button className="w-full gap-2" disabled={saving} onClick={() => void addAdministrator()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {saving ? "Cadastrando..." : "Conceder acesso de admin"}
          </Button>
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-muted-foreground">
            O cadastro público nunca concede essa permissão. Apenas um administrador autenticado pode gerenciar os acessos aqui.
          </p>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Administradores ativos</CardTitle>
              <CardDescription>{admins.length} conta(s) com acesso ao painel.</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar administrador..." className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nenhum administrador encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Administrador</TableHead>
                  <TableHead>Acesso concedido</TableHead>
                  <TableHead className="w-28 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((admin) => {
                  const current = admin.user_id === user?.id;
                  return (
                    <TableRow key={admin.roleId}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{admin.name || "Administrador"}</div>
                        <div className="text-xs text-muted-foreground">{admin.email || admin.user_id}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(admin.grantedAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {current ? (
                          <Badge variant="secondary">Você</Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={admins.length <= 1}
                            onClick={() => setRemoving(admin)}
                            title="Remover acesso administrativo"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover acesso administrativo?</DialogTitle>
            <DialogDescription>
              {removing?.email || removing?.name || "Esta conta"} perderá imediatamente o acesso ao painel. A conta da loja continuará ativa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => void confirmRemoval()}>Remover acesso</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

