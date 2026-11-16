# قالب متغيرات البيئة — Wattar

> آخر تحديث: 2026-11-16 (M2.7 — نظافة الأسرار)

## القاعدة الذهبية

| النوع | أين يُوضع | هل يظهر في التطبيق/اللوحة؟ |
|---|---|---|
| **مفتاح عام** (`sb_publishable_…` / anon key) | `.env` في التطبيق واللوحة + GitHub Actions secrets | نعم — مصمم للعميل، محمي بـ RLS |
| **مفتاح سري** (`service_role`) | أسرار Edge Functions فقط | **ممنوع منعاً باتاً** |
| **أسرار LiveKit** | أسرار Edge Functions فقط | **ممنوع منعاً باتاً** |
| **ملفات Firebase** (`google-services.json`) | GitHub Actions secret → يُنشأ وقت البناء | لا يُرفع للمستودع |

---

## 1) تطبيق الموبايل — `wattar-app/.env`

| المتغير | السرية | الوصف |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | عام | رابط مشروع Supabase (`https://…supabase.co`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | عام | مفتاح النشر `sb_publishable_…` |

لا يوجد أي متغير سري في التطبيق. أي مفتاح `EXPO_PUBLIC_*` يُحزَّم داخل الـAPK ويُعتبر عاماً.

## 2) لوحة الإدارة — `wattar-admin/.env.local`

| المتغير | السرية | الوصف |
|---|---|---|
| `VITE_SUPABASE_URL` | عام | نفس رابط المشروع |
| `VITE_SUPABASE_ANON_KEY` | عام | نفس مفتاح النشر |

`VERCEL_OIDC_TOKEN` يوضع تلقائياً بواسطة Vercel ولا يُرفع للمستودع.

## 3) Edge Functions — `wattar-functions/.env` (محلي فقط)

| المتغير | السرية | الوصف |
|---|---|---|
| `SUPABASE_URL` | عام | يُحقن تلقائياً في Supabase المستضاف |
| `SUPABASE_ANON_KEY` | عام | يُحقن تلقائياً |
| `SUPABASE_SERVICE_ROLE_KEY` | **سري** | يتجاوز RLS — للدوال فقط |
| `LIVEKIT_URL` | عام | `wss://…livekit.cloud` |
| `LIVEKIT_API_KEY` | **سري** | مفتاح خادم LiveKit |
| `LIVEKIT_API_SECRET` | **سري** | سر توقيع رموز LiveKit |
| `ADMIN_PASSWORD_RESET_REDIRECT_URL` | عام | رابط عميق `wattar://reset-password` |

النشر:

```powershell
npx supabase secrets set --env-file .env --project-ref vczyjbqixqzositlkfkn
```

## 4) GitHub Actions Secrets (للبناء فقط)

| الاسم | الوصف |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | يُمرَّر وقت البناء |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | يُمرَّر وقت البناء |
| `GOOGLE_SERVICES_JSON` | محتوى `google-services.json` لـ Firebase/FCM |

## 5) الحماية المطبّقة

- `.gitignore` يتجاهل `**/.env` و`**/.env.*` مع استثناء `**/.env.example`.
- `scripts/check-secrets.mjs` يفشل إذا وُجد مفتاح سري أو JWT داخل الملفات المتتبَّعة، ويعمل في CI على كل دفعة.
- `service_role` يُقرأ فقط من `Deno.env` داخل `wattar-functions/functions/**`، ولا وجود له في التطبيق أو اللوحة.
- تدوير أي مفتاح مسرَّب: تحديث السر في Supabase/Vercel/GitHub ثم إعادة نشر الدوال المتأثرة.
