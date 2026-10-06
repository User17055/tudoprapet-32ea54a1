import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { parseCheckoutAddress, parseCheckoutCustomer } from "../_shared/checkout-input.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;
  const { userId, email } = authResult.auth;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "get";

    if (action === "get") {
      let { data: profile } = await admin.from("checkout_customer_profiles")
        .select("full_name,invoice_email,cpf_cnpj,mobile_phone,billing_same_as_shipping")
        .eq("user_id", userId).maybeSingle();
      // leitura-limitada: enderecos de UM cliente
      let { data: addresses } = await admin.from("customer_addresses")
        .select(
          "id,label,recipient_name,address1,number,address2,neighborhood,city,province_code,postal_code,country_code,is_default_shipping,is_default_billing",
        )
        .eq("user_id", userId).order("is_default_shipping", { ascending: false }).order(
          "updated_at",
          { ascending: false },
        );
      // leitura-limitada: cartoes de UM cliente
      const { data: methods } = await admin.from("customer_payment_methods")
        .select("id,brand,last_four,holder_name,is_default")
        .eq("user_id", userId).is("revoked_at", null).order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      const { data: accountProfile } = await admin.from("profiles")
        .select("name,cpf,cnpj,person_type,is_franchisee,company_legal_name,company_trade_name,state_registration,state_registration_indicator").eq("user_id", userId).maybeSingle();
      const { data: franchiseAccount } = accountProfile?.is_franchisee
        ? await admin.from("franchise_credit_accounts")
          .select("payment_term_days,payment_schedule_type,payment_due_day").eq("user_id", userId).maybeSingle()
        : { data: null };

      // Primeiro acesso: usa o último checkout concluído sem duplicar dados.
      if (!profile || !(addresses ?? []).length) {
        const { data: lastSession } = await admin.from("checkout_sessions")
          .select("customer_snapshot,address_snapshot,billing_address_snapshot")
          .eq("user_id", userId)
          .in("status", ["shopify_created", "credit_approved"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!profile && lastSession?.customer_snapshot) {
          const customer = lastSession.customer_snapshot as Record<string, string>;
          profile = {
            full_name: customer.name || accountProfile?.name || "",
            invoice_email: customer.email || email || "",
            cpf_cnpj: customer.cpfCnpj || "",
            mobile_phone: customer.mobilePhone || "",
            billing_same_as_shipping: true,
          };
        }
        if (
          !(addresses ?? []).length && lastSession?.address_snapshot &&
          Object.keys(lastSession.address_snapshot as object).length
        ) {
          const address = lastSession.address_snapshot as Record<string, string>;
          addresses = [{
            id: null,
            label: "Último pedido",
            recipient_name: profile?.full_name || "",
            address1: address.address1,
            number: address.number,
            address2: address.address2 || null,
            neighborhood: address.neighborhood,
            city: address.city,
            province_code: address.provinceCode,
            postal_code: address.postalCode,
            country_code: "BR",
            is_default_shipping: true,
            is_default_billing: true,
          }];
        }
      }

      return jsonResponse({
        customer: profile
          ? {
            name: profile.full_name,
            email: profile.invoice_email,
            cpfCnpj: profile.cpf_cnpj,
            mobilePhone: profile.mobile_phone,
            billingSameAsShipping: profile.billing_same_as_shipping,
          }
          : {
            name: accountProfile?.name || "",
            email: email || "",
            cpfCnpj: accountProfile?.cnpj || accountProfile?.cpf || "",
            mobilePhone: "",
            billingSameAsShipping: true,
          },
        addresses: addresses ?? [],
        paymentMethods: methods ?? [],
        isFranchisee: Boolean(accountProfile?.is_franchisee),
        franchiseFiscalProfile: accountProfile?.is_franchisee
          ? {
            legalName: accountProfile.company_legal_name || "",
            tradeName: accountProfile.company_trade_name || "",
            cnpj: accountProfile.cnpj || "",
            stateRegistration: accountProfile.state_registration || "",
            stateRegistrationIndicator: accountProfile.state_registration_indicator || "",
          }
          : null,
        paymentTermDays: Number(franchiseAccount?.payment_term_days) >= 1
          ? Number(franchiseAccount?.payment_term_days)
          : 7,
        paymentScheduleType: franchiseAccount?.payment_schedule_type === "fixed_day_next_month"
          ? "fixed_day_next_month"
          : "days_after_order",
        paymentDueDay: Number(franchiseAccount?.payment_due_day) >= 1
          ? Number(franchiseAccount?.payment_due_day)
          : null,
      });
    }

    if (action === "save_contact") {
      const parsed = parseCheckoutCustomer(body.customer);
      if (!parsed.ok) return errorResponse(parsed.message, 400);
      const { data: currentAccount } = await admin.from("profiles")
        .select("is_franchisee,cnpj").eq("user_id", userId).maybeSingle();
      if (currentAccount?.is_franchisee && !currentAccount.cnpj) {
        return errorResponse("Salve primeiro os dados fiscais da franquia", 400);
      }
      const fiscalDocument = currentAccount?.is_franchisee
        ? String(currentAccount.cnpj).replace(/\D/g, "")
        : parsed.value.cpfCnpj;
      const { error } = await admin.from("checkout_customer_profiles").upsert({
        user_id: userId,
        full_name: parsed.value.name,
        invoice_email: parsed.value.email,
        cpf_cnpj: fiscalDocument,
        mobile_phone: parsed.value.mobilePhone,
        billing_same_as_shipping: body.billingSameAsShipping !== false,
      }, { onConflict: "user_id" });
      if (error) throw error;
      if (!currentAccount?.is_franchisee) {
        // Só completa o cadastro quando ele ainda não tem documento; nunca apaga nem troca o existente.
        const { data: docs } = await admin.from("profiles").select("cpf").eq("user_id", userId).maybeSingle();
        if (!docs?.cpf && !currentAccount?.cnpj) {
          const isCompany = parsed.value.cpfCnpj.length === 14;
          const { error: accountError } = await admin.from("profiles").update(isCompany
            ? { person_type: "company", cnpj: parsed.value.cpfCnpj }
            : { person_type: "individual", cpf: parsed.value.cpfCnpj }).eq("user_id", userId);
          // Documento já usado em outra conta não deve travar o checkout.
          if (accountError) console.error("[checkout-customer-data] profile document", accountError.code);
        }
      }
      return jsonResponse({ saved: true });
    }

    if (action === "save_franchise_fiscal") {
      const { data: current } = await admin.from("profiles")
        .select("is_franchisee").eq("user_id", userId).maybeSingle();
      if (!current?.is_franchisee) return errorResponse("Cadastro disponível apenas para franquias", 403);
      const legalName = typeof body.legalName === "string" ? body.legalName.trim().slice(0, 160) : "";
      const tradeName = typeof body.tradeName === "string" ? body.tradeName.trim().slice(0, 160) : "";
      const cnpj = typeof body.cnpj === "string" ? body.cnpj.replace(/\D/g, "") : "";
      const indicator = typeof body.stateRegistrationIndicator === "string"
        ? body.stateRegistrationIndicator
        : "";
      const stateRegistration = typeof body.stateRegistration === "string"
        ? body.stateRegistration.replace(/\D/g, "")
        : "";
      if (legalName.length < 2) return errorResponse("Informe a razão social", 400);
      const { data: validCnpj, error: cnpjError } = await admin.rpc("is_valid_cnpj", { value: cnpj });
      if (cnpjError) throw cnpjError;
      if (!validCnpj) return errorResponse("Informe um CNPJ válido", 400);
      if (!["contributor", "exempt", "non_contributor"].includes(indicator)) {
        return errorResponse("Informe a situação da inscrição estadual", 400);
      }
      if (indicator === "contributor" && !/^\d{2,14}$/.test(stateRegistration)) {
        return errorResponse("Informe uma inscrição estadual válida", 400);
      }
      const { error } = await admin.from("profiles").update({
        person_type: "company",
        cpf: null,
        cnpj,
        company_legal_name: legalName,
        company_trade_name: tradeName || null,
        state_registration: indicator === "contributor" ? stateRegistration : null,
        state_registration_indicator: indicator,
      }).eq("user_id", userId);
      if (error) throw error;
      const { error: checkoutProfileError } = await admin.from("checkout_customer_profiles")
        .update({ full_name: legalName, cpf_cnpj: cnpj }).eq("user_id", userId);
      if (checkoutProfileError) throw checkoutProfileError;
      return jsonResponse({ saved: true });
    }

    if (action === "save_address") {
      const parsed = parseCheckoutAddress(body.address);
      if (!parsed.ok) return errorResponse(parsed.message, 400);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 40) : "Casa";
      const recipientName = typeof body.recipientName === "string"
        ? body.recipientName.trim().slice(0, 160)
        : "";
      const addressId =
        typeof body.addressId === "string" && /^[0-9a-f-]{36}$/i.test(body.addressId)
          ? body.addressId
          : null;
      const { data, error } = await admin.rpc("save_customer_address", {
        p_user_id: userId,
        p_address: { ...parsed.value, label, recipientName: recipientName || "Destinatário" },
        p_address_id: addressId,
        p_default_shipping: body.defaultShipping !== false,
        p_default_billing: body.defaultBilling === true,
      });
      if (error) throw error;
      return jsonResponse({ saved: true, addressId: data?.id ?? null });
    }

    if (action === "delete_address") {
      const id = typeof body.addressId === "string" ? body.addressId : "";
      const { error } = await admin.from("customer_addresses").delete().eq("id", id).eq(
        "user_id",
        userId,
      );
      if (error) throw error;
      return jsonResponse({ deleted: true });
    }

    if (action === "delete_payment_method") {
      const id = typeof body.paymentMethodId === "string" ? body.paymentMethodId : "";
      const { error } = await admin.from("customer_payment_methods")
        .update({ revoked_at: new Date().toISOString(), is_default: false })
        .eq("id", id).eq("user_id", userId);
      if (error) throw error;
      return jsonResponse({ deleted: true });
    }

    return errorResponse("Ação inválida", 400);
  } catch (error) {
    console.error("checkout-customer-data:", error);
    return errorResponse("Não foi possível atualizar seus dados", 500);
  }
});
