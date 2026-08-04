INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'guilhermecortezsimoes@gmail.com'
ON CONFLICT DO NOTHING;