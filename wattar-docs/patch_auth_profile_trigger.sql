-- Apply once to an existing Wattar database so new and existing Auth users
-- receive a matching public.users profile.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, phone, email, username, role, status)
    VALUES (
        NEW.id,
        NEW.phone,
        NEW.email,
        'user_' || substr(replace(NEW.id::text, '-', ''), 1, 12),
        'user',
        'active'
    )
    ON CONFLICT (id) DO UPDATE
        SET phone = EXCLUDED.phone,
            email = EXCLUDED.email;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

INSERT INTO public.users (id, phone, email, username, role, status)
SELECT
    auth_user.id,
    auth_user.phone,
    auth_user.email,
    'user_' || substr(replace(auth_user.id::text, '-', ''), 1, 12),
    'user',
    'active'
FROM auth.users AS auth_user
WHERE NOT EXISTS (
    SELECT 1 FROM public.users AS profile WHERE profile.id = auth_user.id
);
