# Wattar — تطبيق صوتي اجتماعي

تطبيق صوتي اجتماعي بهوية عربية مستقلة يجمع:
- 🎙️ **غرف صوتية** (4 أو 8 مقاعد)
- 🎮 **ألعاب مراهنة** (عجلة الحظ، نرد، Aviator، Plinko)
- 💰 **محفظة داخلية** (شحن/سحب/تحويل)
- 🤝 **نظام وكلاء** (إحالات متعددة المستويات)
- 🛡️ **لوحة تحكم إدارية كاملة** (تحكّم بكل شيء)

---

## ⚡ الإعداد السريع بـ سكربت واحد

```bash
# 1. فك ضغط المشروع
tar -xzf wattar_project.tar.gz
cd wattar

# 2. شغّل سكربت الإعداد التفاعلي
./setup.sh
```

السكربت سيقوم بـ:
- توجيهك لإعداد Supabase
- نشر الـ Edge Functions
- تثبيت حزم لوحة الأدمن وتطبيق المستخدم
- إنشاء ملفات `.env` تلقائيًا

---

## 🚀 النشر للمعاينة

### لوحة الأدمن (مجاني على Vercel/Netlify)
```bash
cd wattar-admin
npm run build
# ارفع مجلد dist/ إلى Vercel أو Netlify
# أو: vercel --prod
```

### تطبيق المستخدم (APK للتحميل المباشر)
```bash
cd wattar-app
# تثبيت EAS CLI (مرة واحدة)
npm install -g eas-cli
eas login

# ربط المشروع بحساب Expo (يولّد projectId تلقائيًا في app.json)
eas init

# بناء APK للتحميل المباشر (مجانًا على EAS Free Tier)
eas build -p android --profile preview

# سيُعطيك رابط تحميل APK مباشر
# يمكنك مشاركته مع المستخدمين للتجربة
```

---

## 📁 البنية

```
wattar/
├── wattar-app/              # تطبيق المستخدم (Expo + React Native)
│   ├── app/                 # شاشات التطبيق (expo-router)
│   │   ├── (auth)/          # شاشات التسجيل
│   │   ├── (tabs)/          # التبويبات الرئيسية
│   │   ├── room/            # غرف صوتية
│   │   └── game/            # صفحات الألعاب
│   ├── src/                 # مكتبات و stores
│   ├── app.json             # إعدادات Expo
│   └── package.json
│
├── wattar-admin/            # لوحة الأدمن (React + Vite + TypeScript)
│   ├── src/
│   │   ├── components/      # مكونات مشتركة
│   │   ├── pages/           # صفحات (Dashboard, Deposits, Users, Agents...)
│   │   ├── store/           # Zustand stores
│   │   └── lib/             # عملاء Supabase
│   └── package.json
│
├── wattar-functions/        # Edge Functions (Supabase / Deno) — 18 دالة
│   ├── _shared/             # مكتبة مشتركة (auth, rate limit, audit)
│   │   ├── supabase.ts
│   │   └── game-engine.ts
│   ├── deploy-functions.sh  # نشر كل الدوال بأمر واحد
│   └── functions/
│       ├── wallet/                       # استعلام الرصيد
│       ├── deposit-request/              # طلب شحن (يدوي)
│       ├── deposit-approve/              # موافقة الأدمن على شحن
│       ├── withdrawal-request/           # طلب سحب (يدوي)
│       ├── withdrawal-approve/           # موافقة الأدمن على سحب
│       ├── transfer/                     # تحويل بين مستخدمين
│       ├── gift-send/                    # إرسال هدايا (ذهب ← ألماس)
│       ├── daily-bonus/                  # مكافأة يومية (كل 24 ساعة)
│       ├── room-leave/                   # مغادرة غرفة (تحرير مقعد + عدادات)
│       ├── livekit-token/                # توكن الصوت الحي (LiveKit)
│       ├── game-wheel/                   # عجلة الحظ
│       ├── game-dice/                    # نرد
│       ├── game-aviator/                 # طيارة المضاعفات
│       ├── game-plinko/                  # بلانغو
│       ├── admin-create-agent/           # إنشاء وكيل
│       ├── admin-create-host/            # إنشاء حساب دخول أولي لمضيفة
│       ├── admin-set-rtp/                # ضبط RTP لمستخدم
│       ├── admin-force-outcome/          # إجبار فوز/خسارة
│       └── admin-credit-agent/           # شحن رصيد وكيل
│
├── wattar-shared/           # أنواع TypeScript مشتركة
│   └── src/
│       ├── types/           # كل الأنواع (User, Wallet, Game...)
│       ├── constants/       # ثوابت
│       └── utils/           # دوال مساعدة
│
└── wattar-docs/             # وثائق
    └── wattar_schema.sql    # قاعدة البيانات الكاملة
```

---

## 🚀 الإعداد السريع

### 1) إعداد Supabase

1. أنشئ مشروعًا جديدًا على [supabase.com](https://supabase.com)
2. افتح **SQL Editor** في لوحة Supabase
3. انسخ محتوى `wattar-docs/wattar_schema.sql` كاملاً والصقه ثم نفّذ
4. أنشئ Storage Buckets:
   - `avatars` (عام)
   - `deposit-proofs` (خاص)
   - `withdrawal-proofs` (خاص)
   - `gift-icons` (عام)
5. أنشئ مستخدم Auth (Email/Password) للأدمن الأول:
   - في Authentication → Users → Add user
   - بعد إنشائه، نفّذ في SQL Editor:
     ```sql
     INSERT INTO users (id, email, username, role, status)
     VALUES ('<user-uuid>', '<email>', 'admin', 'super_admin', 'active')
     ON CONFLICT (id) DO UPDATE SET role = 'super_admin';
     ```

### 2) إعداد Edge Functions

```bash
cd wattar-functions
./deploy-functions.sh <your-project-ref>
```

أو يدويًا:

```bash
for fn in wallet deposit-request deposit-approve withdrawal-request \
  withdrawal-approve transfer gift-send daily-bonus room-join room-leave \
  room-owner-action livekit-token game-wheel game-dice game-aviator \
  game-plinko game-slots admin-create-agent admin-create-host \
  agent-phone-login admin-set-agent-status host-application-review \
  admin-manage-host admin-set-rtp admin-set-user-status admin-force-outcome \
  admin-credit-agent social-push delete-account auth-send-phone-otp \
  auth-sign-up-email admin-delete-user admin-reset-user-password; do
  supabase functions deploy "$fn" --no-verify-jwt
done
```

أضف متغيرات البيئة في Supabase → Settings → Edge Functions → Secrets:
- `SUPABASE_URL` (تلقائي)
- `SUPABASE_SERVICE_ROLE_KEY` (تلقائي)

### 2ب) تفعيل الصوت الحي في الغرف (اختياري)

الغرف تعمل بشكل كامل بدون صوت (شات + مقاعد + هدايا). لتفعيل الصوت الحي:

1. أنشئ حسابًا مجانيًا على [LiveKit Cloud](https://cloud.livekit.io) واحصل على:
   - `LIVEKIT_URL` (مثل wss://xxxx.livekit.cloud)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
2. نفّذ:
   ```bash
   supabase secrets set LIVEKIT_URL=wss://xxxx.livekit.cloud \
     LIVEKIT_API_KEY=xxxx LIVEKIT_API_SECRET=xxxx
   ```
3. أعد نشر دالة `livekit-token` فقط.

بعد ذلك يظهر في الغرف مؤشر «صوت مباشر» ويعمل الميكروفون تلقائيًا.

### 3) إعداد لوحة الأدمن

```bash
cd wattar-admin
cp .env.example .env.local
# عدّل القيم في .env.local

npm install
npm run dev
# افتح http://localhost:5174
```

### 4) إعداد تطبيق المستخدم

```bash
cd wattar-app
cp .env.example .env
# عدّل القيم في .env

npm install
# لتشغيل التطوير (يحتاج جهاز Android أو محاكي)
npx expo start --dev-client

# لبناء APK للتحميل المباشر
eas build -p android --profile preview
```

---

## 🔐 الميزات الأمنية

### المحفظة
- ✅ **Append-only ledger** — لا UPDATE / لا DELETE
- ✅ **Atomic operations** عبر `record_wallet_transaction()`
- ✅ **Row Locking** لمنع الرصيد السالب
- ✅ **Idempotency keys** لمنع الازدواج
- ✅ **Double-entry** مع `balance_before` و `balance_after`

### الألعاب
- ✅ **Server-Authoritative** — كل النتائج تُحسب على السيرفر
- ✅ **Secure RNG** عبر `crypto.getRandomValues`
- ✅ **RTP configurable** لكل لعبة + لكل مستخدم
- ✅ **Forced outcomes** (win/lose) قابلة للإلغاء تلقائيًا
- ✅ **Seed لكل جولة** للتحقق
- ✅ **Bet limits** (min/max) قابلة للتعديل

### الوصول
- ✅ **Row Level Security** على كل جدول
- ✅ **JWT verification** في كل Edge Function
- ✅ **Role-based access** (user / agent / admin / super_admin)
- ✅ **Rate limiting** لمنع الإغراق
- ✅ **Audit log** لكل عملية إدارية

---

## 🎯 التدفقات الرئيسية

### الشحن اليدوي
```
المستخدم → يطلب شحن + يرفع صورة + رقم العملية
       ↓
deposits.status = pending
       ↓
الأدمن/الوكيل يراجع → يوافق
       ↓
deposit-approve Edge Function:
  1) record_wallet_transaction(type='deposit', amount=+gold)
  2) إضافة عمولة للوكيل (10%)
  3) deposits.status = completed
```

### السحب اليدوي
```
المستخدم → يطلب سحب
       ↓
withdrawal-request:
  1) خصم الرصيد فورًا (held)
  2) withdrawals.status = pending
       ↓
الوكيل يحوّل للمستخدم خارجيًا
       ↓
يرفع رقم العملية + صورة الإثبات
       ↓
withdrawal-approve Edge Function:
  1) withdrawals.status = completed
  2) تحديث رصيد الوكيل (-net_usd)
  3) تحديث إحصائيات
  (إذا رُفض: يُعاد الرصيد للمستخدم)
```

### الألعاب
```
المستخدم → يراهن (مثلاً: عجلة الحظ، خانة x10)
       ↓
game-wheel Edge Function:
  1) التحقق من الرصيد + حدود الرهان
  2) جلب إعدادات اللعبة (RTP افتراضي)
  3) جلب حالة المستخدم (RTP override, force flags)
  4) حساب النتيجة عبر secure RNG
  5) خصم الرهان: record_wallet_transaction(type='bet', amount=-bet)
  6) إنشاء game_round + game_bet
  7) إذا فاز: record_wallet_transaction(type='win', amount=+payout)
  8) تصفير force flags (إن وُجدت)
  9) إرجاع النتيجة للمستخدم
```

---

## 📊 التطويرات المستقبلية

### المرحلة 2 (عند الانتقال للخطة المدفوعة)
- 🎥 **بث فيديو لايف** داخل الغرف
- 📞 **مكالمات فيديو خاصة 1:1**
- 👨‍👩‍👧 **العائلات (Families/Clans)** — تجمعات مستخدمين
- 🤖 **AI models** — ترحيب آلي، تصفية محتوى
- ⚡ **رفع حدود التخزين** للـ VIP
- 🎨 **سوق الإطارات والخلفيات**
- 🔊 **تسجيل الغرف** كميزة مدفوعة
- 🎫 **VIP tiers** (Silver, Gold, Diamond)

### التطويرات التقنية المستقبلية
- ✅ البنية الحالية تدعم إضافة ألعاب جديدة بسهولة (إضافة إلى `game_type` ENUM)
- ✅ البنية تدعم عملات متعددة (gold, diamond، وأي عملة مستقبلية)
- ✅ البنية تدعم مستويات وكلاء متعددة (tiers)
- ✅ الـ Audit log يدعم أي نوع عملية جديدة
- ✅ الـ RLS يدعم صلاحيات هرمية معقدة

---

## 📞 الدعم

لأي استفسار أو مساعدة في الإعداد، راجع:
1. الوثائق في `wattar-docs/`
2. السكيمة الكاملة في `wattar-docs/wattar_schema.sql`
3. وثائق Supabase: https://supabase.com/docs
4. وثائق Expo: https://docs.expo.dev

---

**Wattar v1.0.0** — © 2025
