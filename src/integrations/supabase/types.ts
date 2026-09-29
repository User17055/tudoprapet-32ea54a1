export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attribute_keys: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      attribute_values: {
        Row: {
          attr_key: string
          attr_value: string
          created_at: string
          id: string
          sort_order: number
        }
        Insert: {
          attr_key: string
          attr_value: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Update: {
          attr_key?: string
          attr_value?: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_attempt_logs: {
        Row: {
          checkout_session_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          error_message: string | null
          id: string
          metadata: Json
          payment_method: string
          provider_payment_id: string | null
          stage: string
          success: boolean
          user_id: string | null
        }
        Insert: {
          checkout_session_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          payment_method?: string
          provider_payment_id?: string | null
          stage: string
          success: boolean
          user_id?: string | null
        }
        Update: {
          checkout_session_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          payment_method?: string
          provider_payment_id?: string | null
          stage?: string
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_attempt_logs_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_customer_profiles: {
        Row: {
          asaas_customer_id: string | null
          billing_same_as_shipping: boolean
          cpf_cnpj: string
          created_at: string
          full_name: string
          invoice_email: string
          mobile_phone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asaas_customer_id?: string | null
          billing_same_as_shipping?: boolean
          cpf_cnpj: string
          created_at?: string
          full_name: string
          invoice_email: string
          mobile_phone: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asaas_customer_id?: string | null
          billing_same_as_shipping?: boolean
          cpf_cnpj?: string
          created_at?: string
          full_name?: string
          invoice_email?: string
          mobile_phone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkout_rate_limits: {
        Row: {
          key_hash: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          key_hash: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          key_hash?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      checkout_sessions: {
        Row: {
          address_snapshot: Json
          anonymous_access_token_expires_at: string | null
          anonymous_access_token_hash: string | null
          billing_address_snapshot: Json
          checkout_version: string
          commission_percent: number
          created_at: string
          currency: string
          customer_snapshot: Json
          customer_type: string
          discount: number
          franchise_payment_term_days: number | null
          id: string
          inventory_reserved_until: string | null
          invoice_purpose: string | null
          items_snapshot: Json
          olist_invoice_id: string | null
          olist_invoice_number: string | null
          olist_invoice_url: string | null
          olist_order_id: string | null
          olist_order_number: string | null
          olist_receivable_id: string | null
          pricing_snapshot: Json
          referral_code: string | null
          referral_employee_name: string | null
          service_fee: number
          session_expires_at: string | null
          shipping_amount: number
          shipping_code: string | null
          shipping_method: string | null
          shopify_draft_order_id: string | null
          shopify_order_id: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address_snapshot?: Json
          anonymous_access_token_expires_at?: string | null
          anonymous_access_token_hash?: string | null
          billing_address_snapshot?: Json
          checkout_version?: string
          commission_percent?: number
          created_at?: string
          currency?: string
          customer_snapshot?: Json
          customer_type: string
          discount?: number
          franchise_payment_term_days?: number | null
          id?: string
          inventory_reserved_until?: string | null
          invoice_purpose?: string | null
          items_snapshot?: Json
          olist_invoice_id?: string | null
          olist_invoice_number?: string | null
          olist_invoice_url?: string | null
          olist_order_id?: string | null
          olist_order_number?: string | null
          olist_receivable_id?: string | null
          pricing_snapshot?: Json
          referral_code?: string | null
          referral_employee_name?: string | null
          service_fee?: number
          session_expires_at?: string | null
          shipping_amount?: number
          shipping_code?: string | null
          shipping_method?: string | null
          shopify_draft_order_id?: string | null
          shopify_order_id?: string | null
          status?: string
          subtotal: number
          total: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address_snapshot?: Json
          anonymous_access_token_expires_at?: string | null
          anonymous_access_token_hash?: string | null
          billing_address_snapshot?: Json
          checkout_version?: string
          commission_percent?: number
          created_at?: string
          currency?: string
          customer_snapshot?: Json
          customer_type?: string
          discount?: number
          franchise_payment_term_days?: number | null
          id?: string
          inventory_reserved_until?: string | null
          invoice_purpose?: string | null
          items_snapshot?: Json
          olist_invoice_id?: string | null
          olist_invoice_number?: string | null
          olist_invoice_url?: string | null
          olist_order_id?: string | null
          olist_order_number?: string | null
          olist_receivable_id?: string | null
          pricing_snapshot?: Json
          referral_code?: string | null
          referral_employee_name?: string | null
          service_fee?: number
          session_expires_at?: string | null
          shipping_amount?: number
          shipping_code?: string | null
          shipping_method?: string | null
          shopify_draft_order_id?: string | null
          shopify_order_id?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      club_members: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          name?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string | null
        }
        Relationships: []
      }
      commission_blocked_customers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      commission_rules: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          percent: number
          scope: string
          shopify_product_id: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          percent: number
          scope: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          percent?: number
          scope?: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_settings: {
        Row: {
          id: boolean
          store_percent: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          store_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          store_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          address1: string
          address2: string | null
          city: string
          country_code: string
          created_at: string
          id: string
          is_default_billing: boolean
          is_default_shipping: boolean
          label: string
          neighborhood: string
          number: string
          postal_code: string
          province_code: string
          recipient_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address1: string
          address2?: string | null
          city: string
          country_code?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string
          neighborhood: string
          number: string
          postal_code: string
          province_code: string
          recipient_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address1?: string
          address2?: string | null
          city?: string
          country_code?: string
          created_at?: string
          id?: string
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string
          neighborhood?: string
          number?: string
          postal_code?: string
          province_code?: string
          recipient_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          holder_name: string | null
          id: string
          is_default: boolean
          last_four: string
          provider: string
          provider_customer_id: string
          revoked_at: string | null
          token_ciphertext: string
          token_iv: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          holder_name?: string | null
          id?: string
          is_default?: boolean
          last_four: string
          provider?: string
          provider_customer_id: string
          revoked_at?: string | null
          token_ciphertext: string
          token_iv: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          holder_name?: string | null
          id?: string
          is_default?: boolean
          last_four?: string
          provider?: string
          provider_customer_id?: string
          revoked_at?: string | null
          token_ciphertext?: string
          token_iv?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_prices: {
        Row: {
          created_at: string
          previous_price: number | null
          price: number
          price_changed_at: string | null
          shopify_product_id: string
          shopify_variant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          previous_price?: number | null
          price: number
          price_changed_at?: string | null
          shopify_product_id: string
          shopify_variant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          previous_price?: number | null
          price?: number
          price_changed_at?: string | null
          shopify_product_id?: string
          shopify_variant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_referral_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          employee_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          employee_name?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          employee_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      featured_products: {
        Row: {
          created_at: string
          id: string
          shopify_product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          shopify_product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          shopify_product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      franchise_credit_accounts: {
        Row: {
          block_on_any_open_invoice: boolean
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string
          credit_limit: number | null
          manually_blocked: boolean
          payment_term_days: number
          payment_term_updated_at: string | null
          payment_term_updated_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          block_on_any_open_invoice?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          credit_limit?: number | null
          manually_blocked?: boolean
          payment_term_days?: number
          payment_term_updated_at?: string | null
          payment_term_updated_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          block_on_any_open_invoice?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          credit_limit?: number | null
          manually_blocked?: boolean
          payment_term_days?: number
          payment_term_updated_at?: string | null
          payment_term_updated_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      franchise_prices: {
        Row: {
          created_at: string
          price: number
          shopify_product_id: string
          shopify_variant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          price: number
          shopify_product_id: string
          shopify_variant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          price?: number
          shopify_product_id?: string
          shopify_variant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      hero_banners: {
        Row: {
          active: boolean
          created_at: string
          id: string
          image_path: string
          link_url: string | null
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_path: string
          link_url?: string | null
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_path?: string
          link_url?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      payment_actions: {
        Row: {
          action_type: string
          attempts: number
          created_at: string
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          payment_id: string
          processed_at: string | null
          processing_error: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_type: string
          attempts?: number
          created_at?: string
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          payment_id: string
          processed_at?: string | null
          processing_error?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          attempts?: number
          created_at?: string
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          payment_id?: string
          processed_at?: string | null
          processing_error?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_actions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          attempts: number
          event_type: string
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          payload: Json
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          provider_payment_id: string | null
          received_at: string
          status: string
        }
        Insert: {
          attempts?: number
          event_type: string
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_event_id: string
          provider_payment_id?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          event_type?: string
          id?: string
          locked_at?: string | null
          next_attempt_at?: string | null
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string
          provider_payment_id?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          attempt_number: number
          checkout_session_id: string
          confirmed_at: string | null
          created_at: string
          due_date: string | null
          external_reference: string
          id: string
          is_active: boolean
          method: string
          pix_expires_at: string | null
          provider: string
          provider_customer_id: string | null
          provider_deleted_at: string | null
          provider_expires_at: string | null
          provider_payment_id: string | null
          provider_payment_url: string | null
          raw_status: string | null
          received_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          attempt_number: number
          checkout_session_id: string
          confirmed_at?: string | null
          created_at?: string
          due_date?: string | null
          external_reference: string
          id?: string
          is_active?: boolean
          method: string
          pix_expires_at?: string | null
          provider: string
          provider_customer_id?: string | null
          provider_deleted_at?: string | null
          provider_expires_at?: string | null
          provider_payment_id?: string | null
          provider_payment_url?: string | null
          raw_status?: string | null
          received_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          attempt_number?: number
          checkout_session_id?: string
          confirmed_at?: string | null
          created_at?: string
          due_date?: string | null
          external_reference?: string
          id?: string
          is_active?: boolean
          method?: string
          pix_expires_at?: string | null
          provider?: string
          provider_customer_id?: string | null
          provider_deleted_at?: string | null
          provider_expires_at?: string | null
          provider_payment_id?: string | null
          provider_payment_url?: string | null
          raw_status?: string | null
          received_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          order_id: string
          order_name: string
          printed_at: string | null
          source: string
          status: string
          zpl: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          order_id: string
          order_name: string
          printed_at?: string | null
          source?: string
          status?: string
          zpl: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          order_id?: string
          order_name?: string
          printed_at?: string | null
          source?: string
          status?: string
          zpl?: string
        }
        Relationships: []
      }
      product_attributes: {
        Row: {
          attr_key: string
          attr_value: string
          created_at: string
          id: string
          shopify_product_id: string
          sort_order: number
        }
        Insert: {
          attr_key: string
          attr_value: string
          created_at?: string
          id?: string
          shopify_product_id: string
          sort_order?: number
        }
        Update: {
          attr_key?: string
          attr_value?: string
          created_at?: string
          id?: string
          shopify_product_id?: string
          sort_order?: number
        }
        Relationships: []
      }
      product_audience: {
        Row: {
          audience: string
          created_at: string
          shopify_product_id: string
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          shopify_product_id: string
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          shopify_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          shopify_product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          shopify_product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          shopify_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_content: {
        Row: {
          brand_id: string | null
          created_at: string
          description: string | null
          id: string
          shopify_product_id: string
          specifications: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          shopify_product_id: string
          specifications?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          shopify_product_id?: string
          specifications?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_content_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      product_cost_history: {
        Row: {
          changed_at: string
          id: string
          new_cost: number
          old_cost: number | null
          shopify_variant_id: string
          source: string
        }
        Insert: {
          changed_at?: string
          id?: string
          new_cost: number
          old_cost?: number | null
          shopify_variant_id: string
          source?: string
        }
        Update: {
          changed_at?: string
          id?: string
          new_cost?: number
          old_cost?: number | null
          shopify_variant_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_history_shopify_variant_id_fkey"
            columns: ["shopify_variant_id"]
            isOneToOne: false
            referencedRelation: "product_costs"
            referencedColumns: ["shopify_variant_id"]
          },
        ]
      }
      product_costs: {
        Row: {
          cost: number
          cost_changed_at: string | null
          created_at: string
          previous_cost: number | null
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          source: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          cost: number
          cost_changed_at?: string | null
          created_at?: string
          previous_cost?: number | null
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          source?: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          cost?: number
          cost_changed_at?: string | null
          created_at?: string
          previous_cost?: number | null
          shopify_product_id?: string
          shopify_variant_id?: string
          sku?: string
          source?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_detail_profile_attributes: {
        Row: {
          attr_key: string
          attr_value: string
          id: string
          profile_id: string
          sort_order: number
        }
        Insert: {
          attr_key: string
          attr_value: string
          id?: string
          profile_id: string
          sort_order?: number
        }
        Update: {
          attr_key?: string
          attr_value?: string
          id?: string
          profile_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_detail_profile_attributes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "product_detail_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_detail_profile_categories: {
        Row: {
          category_id: string
          profile_id: string
        }
        Insert: {
          category_id: string
          profile_id: string
        }
        Update: {
          category_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_detail_profile_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_detail_profile_categories_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "product_detail_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_detail_profiles: {
        Row: {
          brand_id: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_detail_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variation_groups: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_variation_items: {
        Row: {
          created_at: string
          group_id: string
          id: string
          label: string
          shopify_product_handle: string
          shopify_product_id: string
          shopify_product_title: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          label: string
          shopify_product_handle: string
          shopify_product_id: string
          shopify_product_title: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          label?: string
          shopify_product_handle?: string
          shopify_product_id?: string
          shopify_product_title?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variation_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "product_variation_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          acquisition_source: string | null
          cnpj: string | null
          company_legal_name: string | null
          company_trade_name: string | null
          cpf: string | null
          created_at: string
          email: string | null
          id: string
          is_franchisee: boolean
          name: string | null
          person_type: string
          referral_code: string | null
          state_registration: string | null
          state_registration_indicator: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acquisition_source?: string | null
          cnpj?: string | null
          company_legal_name?: string | null
          company_trade_name?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_franchisee?: boolean
          name?: string | null
          person_type?: string
          referral_code?: string | null
          state_registration?: string | null
          state_registration_indicator?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acquisition_source?: string | null
          cnpj?: string | null
          company_legal_name?: string | null
          company_trade_name?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_franchisee?: boolean
          name?: string | null
          person_type?: string
          referral_code?: string | null
          state_registration?: string | null
          state_registration_indicator?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      site_maintenance: {
        Row: {
          enabled: boolean
          ends_at: string | null
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          ends_at?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          ends_at?: string | null
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      subscriber_prices: {
        Row: {
          created_at: string
          id: string
          shopify_product_id: string
          shopify_variant_id: string
          subscriber_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          shopify_product_id: string
          shopify_variant_id: string
          subscriber_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          shopify_product_id?: string
          shopify_variant_id?: string
          subscriber_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_carts: {
        Row: {
          cart_id: string | null
          checkout_url: string | null
          created_at: string
          discount_code: string | null
          has_auto_opened_cart: boolean
          items: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          cart_id?: string | null
          checkout_url?: string | null
          created_at?: string
          discount_code?: string | null
          has_auto_opened_cart?: boolean
          items?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          cart_id?: string | null
          checkout_url?: string | null
          created_at?: string
          discount_code?: string | null
          has_auto_opened_cart?: boolean
          items?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_payment_actions: {
        Args: { p_limit?: number }
        Returns: {
          action_type: string
          attempts: number
          created_at: string
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          payment_id: string
          processed_at: string | null
          processing_error: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_actions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_payment_events: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          event_type: string
          id: string
          locked_at: string | null
          next_attempt_at: string | null
          payload: Json
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string
          provider_payment_id: string | null
          received_at: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_checkout_rate_limit: {
        Args: {
          p_key_hash: string
          p_limit?: number
          p_window_seconds?: number
        }
        Returns: number
      }
      create_payment_attempt: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_due_date?: string
          p_method: string
          p_provider: string
        }
        Returns: {
          amount: number
          attempt_number: number
          checkout_session_id: string
          confirmed_at: string | null
          created_at: string
          due_date: string | null
          external_reference: string
          id: string
          is_active: boolean
          method: string
          pix_expires_at: string | null
          provider: string
          provider_customer_id: string | null
          provider_deleted_at: string | null
          provider_expires_at: string | null
          provider_payment_id: string | null
          provider_payment_url: string | null
          raw_status: string | null
          received_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_olist_franchise_reconciliation: { Args: never; Returns: undefined }
      invoke_payment_reconciliation: { Args: never; Returns: undefined }
      is_cpf_available: { Args: { _cpf: string }; Returns: boolean }
      is_franchisee: { Args: { _user_id: string }; Returns: boolean }
      is_tax_id_available: { Args: { _tax_id: string }; Returns: boolean }
      is_valid_cnpj: { Args: { value: string }; Returns: boolean }
      is_valid_cpf: { Args: { value: string }; Returns: boolean }
      save_customer_address: {
        Args: {
          p_address: Json
          p_address_id?: string
          p_default_billing?: boolean
          p_default_shipping?: boolean
          p_user_id: string
        }
        Returns: {
          address1: string
          address2: string | null
          city: string
          country_code: string
          created_at: string
          id: string
          is_default_billing: boolean
          is_default_shipping: boolean
          label: string
          neighborhood: string
          number: string
          postal_code: string
          province_code: string
          recipient_name: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "customer_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_referral_code: { Args: { _code: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
