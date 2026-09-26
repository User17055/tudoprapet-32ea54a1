import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (input: { firstName: string; lastName: string; email: string; personType: "individual" | "company"; taxId: string; password: string; acquisitionSource: string; referralCode?: string }) => Promise<{ success: boolean; signedIn?: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * A Supabase devolve o erro em ingles ("Invalid login credentials"). Traduzimos
 * aqui, no unico ponto que fala com ela, para que as paginas nao precisem saber
 * disso — Login e Register recebem a mensagem ja pronta.
 *
 * A chave e o `code` e nao o texto: codigo nao muda quando eles reescrevem a
 * mensagem numa atualizacao.
 */
const MENSAGENS_AUTH: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.',
  user_already_exists: 'Este e-mail ja esta cadastrado.',
  email_exists: 'Este e-mail ja esta cadastrado.',
  weak_password: 'Escolha uma senha mais forte.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde um instante.',
  over_email_send_rate_limit: 'Muitas tentativas. Aguarde um instante.',
};

// `invalid_credentials` cobre e-mail inexistente E senha errada — a Supabase nao
// distingue os dois de proposito, para nao permitir descobrir quem tem conta na
// loja. Nao separe essas mensagens.
const traduzirErro = (error: { code?: string }, padrao: string) =>
  (error.code && MENSAGENS_AUTH[error.code]) || padrao;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { success: false, error: traduzirErro(error, 'Nao foi possivel entrar. Tente novamente.') };
      }
      return { success: true };
    } catch {
      // Falha de rede tambem vem em ingles; nao repassamos.
      return { success: false, error: 'Nao foi possivel entrar. Verifique sua conexao.' };
    }
  };

  const register = async (input: { firstName: string; lastName: string; email: string; personType: "individual" | "company"; taxId: string; password: string; acquisitionSource: string; referralCode?: string }) => {
    try {
      const fullName = `${input.firstName} ${input.lastName}`.trim();
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            name: fullName,
            full_name: fullName,
            first_name: input.firstName,
            last_name: input.lastName,
            person_type: input.personType,
            cpf: input.personType === "individual" ? input.taxId : "",
            cnpj: input.personType === "company" ? input.taxId : "",
            acquisition_source: input.acquisitionSource,
            referral_code: input.referralCode || '',
          },
        },
      });
      if (error) {
        return { success: false, error: traduzirErro(error, 'Nao foi possivel criar a conta. Tente novamente.') };
      }
      return { success: true, signedIn: Boolean(data.session) };
    } catch {
      return { success: false, error: 'Nao foi possivel criar a conta. Verifique sua conexao.' };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
