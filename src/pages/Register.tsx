import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, CreditCard, Lock, Mail, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AuthField } from '@/components/auth/AuthField';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cpfDigits, isValidCpf, maskCpf } from '@/lib/cpf';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SOURCE_OPTIONS = [
  { value: 'google', label: 'Google' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'recomendacao', label: 'Recomendacao' },
  { value: 'outro', label: 'Outro' },
];

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const passwordRules = [
    { label: 'Pelo menos 8 caracteres', valid: password.length >= 8 },
    { label: 'Uma letra maiuscula', valid: /[A-Z]/.test(password) },
    { label: 'Uma letra minuscula', valid: /[a-z]/.test(password) },
    { label: 'Um numero', valid: /\d/.test(password) },
    { label: 'Um caractere especial, como @, # ou !', valid: /[^A-Za-z0-9]/.test(password) },
  ];
  const isPasswordSecure = passwordRules.every((rule) => rule.valid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordSecure) {
      toast.error('Crie uma senha segura seguindo todos os requisitos.');
      return;
    }
    if (!isValidCpf(cpf)) {
      toast.error('Informe um CPF valido.');
      return;
    }
    if (!acquisitionSource) {
      toast.error('Informe de onde voce conheceu a TudoPraPet.');
      return;
    }
    if (acquisitionSource === 'recomendacao' && !referralCode.trim()) {
      toast.error('Informe o codigo de quem indicou voce.');
      return;
    }
    const normalizedReferralCode = referralCode.trim().toUpperCase();
    if (acquisitionSource === 'recomendacao') {
      const { data, error } = await supabase.rpc('validate_referral_code', {
        _code: normalizedReferralCode,
      });

      if (error || !data) {
        toast.error('Codigo de funcionario invalido ou inativo.');
        return;
      }
    }
    setLoading(true);
    try {
      const result = await register({
        firstName,
        lastName,
        email,
        cpf: cpfDigits(cpf),
        password,
        acquisitionSource,
        referralCode: normalizedReferralCode,
      });
      if (result.success) {
        toast.success('Conta criada! Confira seu e-mail para continuar.');
        navigate('/login');
      } else {
        toast.error(result.error || 'Erro ao criar conta.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      backTo="/catalogo"
      backLabel="Catálogo"
      eyebrow="É rápido e gratuito"
      title="Criar conta"
      panelTitle="Cuide melhor do seu pet."
      panelText="Ofertas, compras mais rápidas e histórico de pedidos em um lugar só."
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{' '}
          <Link to="/login" className="font-bold text-primary hover:underline">
            Entrar
          </Link>
        </p>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-border bg-background p-6 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-3">
          <AuthField
            id="firstName"
            label="Nome"
            icon={UserIcon}
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            placeholder="João"
          />
          <AuthField
            id="lastName"
            label="Sobrenome"
            icon={UserIcon}
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            placeholder="Silva"
          />
        </div>

        <AuthField
          id="email"
          label="E-mail"
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="seu@email.com"
        />

        <AuthField
          id="cpf"
          label="CPF"
          icon={CreditCard}
          inputMode="numeric"
          autoComplete="off"
          value={cpf}
          onChange={(e) => setCpf(maskCpf(e.target.value))}
          required
          maxLength={14}
          placeholder="000.000.000-00"
          aria-invalid={cpf.length === 14 && !isValidCpf(cpf)}
        />

        <div className="space-y-2">
          <label className="text-sm font-bold text-foreground">
            Como voce conheceu a TudoPraPet?
          </label>
          <Select value={acquisitionSource} onValueChange={setAcquisitionSource}>
            <SelectTrigger className="h-12 rounded-xl border border-input bg-background px-4 text-base focus:border-primary focus:ring-4 focus:ring-secondary/30">
              <SelectValue placeholder="Selecione uma opcao" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {acquisitionSource === 'recomendacao' && (
          <AuthField
            id="referralCode"
            label="Codigo de indicacao"
            icon={UserIcon}
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            required
            placeholder="Ex: JOAO10"
            className="uppercase"
          />
        )}

        <div className="space-y-2">
          <AuthField
            id="password"
            label="Senha"
            icon={Lock}
            revealable
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Senha segura"
          />

          <ul className="space-y-1.5 rounded-xl bg-muted/40 p-3">
            {passwordRules.map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-2 text-xs ${
                  rule.valid ? 'text-pet-green' : 'text-muted-foreground'
                }`}
              >
                {rule.valid ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0" />
                )}
                <span>{rule.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button
          type="submit"
          disabled={loading || !isPasswordSecure}
          className="btn-bounce h-12 w-full rounded-xl font-display text-base font-bold"
        >
          {loading ? 'Criando conta...' : 'Criar minha conta'}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Ao criar conta você aceita nossos termos e política de privacidade.
        </p>
      </form>
    </AuthLayout>
  );
};

export default Register;
