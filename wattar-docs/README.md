# Wattar — تطبيق صوتي اجتماعي

تطبيق صوتي اجتماعي بهوية عربية مستقلة يجمع:
- 🎙️ **غرف صوتية** (4 أو 8 مقاعد)
- 🎮 **ألعاب نقاط مجانية** (عجلة الحظ، نرد، Aviator، Plinko، Slots)
- 🎯 **مهمات يومية** بمكافآت نقاط مجانية وXP يتحقق منها الخادم
- 🎁 **متجر هدايا** مرتبط بإرسال الهدايا والأرصدة المنفصلة
- 💰 **محفظة متعددة الأرصدة** (Coins مدفوعة ومحوّلة، Diamonds قابلة للسحب وترويجية)
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
│   │   ├── missions.tsx     # مهمات يومية بمكافآت نقاط مجانية وXP
│   │   ├── store.tsx        # كتالوج الهدايا والإرسال
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
├── wattar-functions/        # Edge Functions (Supabase / Deno)
│   └── functions/
│       ├── _shared/         # مكتبة مشتركة (auth, rate limit, audit)
│       │   ├── supabase.ts
│       │   └── game-engine.ts
│       ├── wallet/                       # استعلام الرصيد
│       ├── deposit-request/              # طلب شحن (يدوي)
│       ├── deposit-approve/              # موافقة الأدمن على شحن
│       ├── withdrawal-request/           # طلب سحب (يدوي)
│       ├── withdrawal-approve/           # موافقة الأدمن على سحب
│       ├── transfer/                     # تحويل بين مستخدمين
│       ├── gift-send/                    # إرسال الهدايا
│       ├── daily-bonus/                  # المكافأة اليومية
│       ├── room-leave/                   # مغادرة الغرفة
│       ├── livekit-token/                # توكن الصوت الحي
│       ├── game-wheel/                   # عجلة الحظ
│       ├── game-dice/                    # نرد
│       ├── game-aviator/                 # طيارة المضاعفات
│       ├── game-plinko/                  # بلانغو
│       ├── game-slots/                   # Slots بنقاط لعب مجانية
│       ├── admin-create-agent/           # إنشاء وكيل
│       ├── admin-set-rtp/                # ضبط RTP لمستخدم
│       ├── admin-set-user-status/        # إيقاف/حظر مستخدم مع تسجيل السبب
│       ├── admin-force-outcome/          # إجبار فوز/خسارة
│       ├── admin-credit-agent/            # شحن رصيد وكيل
│       ├── social-push/                   # إشعارات اجتماعية معتمدة من الخادم
│       └── delete-account/                # إخفاء بيانات الحساب وحذف وسائطه
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
   - إذا كانت قاعدة البيانات مُهيأة مسبقًا، نفّذ ملفات `patch_auth_profile_trigger.sql` و`patch_admin_rls.sql` و`patch_room_access.sql` و`patch_financial_rls.sql` من مجلد `wattar-docs`؛ لا تعِد تشغيل السكيمة كاملة.
4. بعد ترحيل اقتصاد المحفظة، نفّذ `patch_store_missions.sql` لإضافة مهمات يومية يتحقق منها الخادم ومكافآت نقاط لعب مجانية وXP، مع واجهة متجر للهدايا الموجودة.
5. نفّذ `patch_slots_enum.sql` منفصلًا، ثم بعد نجاحه نفّذ `patch_slots_game_config.sql` لتسجيل Slots كنقاط مجانية فقط.
6. بعد اكتمال جميع ترحيلات قاعدة البيانات، نفّذ `wattar-docs/patch_admin_audit_controls.sql` لتفعيل سجل تغييرات الإدارة وإجراءات حالة المستخدم المسجلة وتدقيق إعداد المهمات.
7. أنشئ Storage Buckets:
   - `avatars` (عام)
   - `deposit-proofs` (خاص)
   - `withdrawal-proofs` (خاص)
   - `gift-icons` (عام)
8. أنشئ مستخدم Auth (Email/Password) للأدمن الأول:
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
# ثبّت Supabase CLI (إن لم يكن مثبتًا)
npm install -g supabase

# سجّل الدخول
supabase login

# انشر كل الدوال من مجلد wattar-functions (Windows PowerShell)
.\deploy-functions.ps1 -ProjectRef <project-ref>
```

أضف متغيرات البيئة في Supabase → Settings → Edge Functions → Secrets:
- `SUPABASE_URL` (تلقائي)
- `SUPABASE_SERVICE_ROLE_KEY` (تلقائي)

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

للبناء السحابي عبر EAS، أضف `EXPO_PUBLIC_SUPABASE_URL` و
`EXPO_PUBLIC_SUPABASE_ANON_KEY` إلى بيئة EAS المستخدمة للبناء؛ لا تضع
مفتاح `service_role` في التطبيق أو في إعدادات البناء.

---

## 🔐 الميزات الأمنية

### المحفظة
- ✅ **Append-only ledger** — لا UPDATE / لا DELETE
- ✅ **Atomic operations** عبر `record_wallet_transaction()`
- ✅ **Row Locking** لمنع الرصيد السالب
- ✅ **Idempotency keys** لمنع الازدواج
- ✅ **فصل الأرصدة**: Coins مدفوعة، Coins محوّلة، Diamonds قابلة للسحب، وDiamonds ترويجية
- ✅ **مخزون الوكيل** لا يُضاف إلا بعد تأكيد الإدارة استلام الدفع مسبقًا
- ✅ **Coins الألعاب مجانية بالكامل** ولا يمكن استخدامها لهدايا الدعم أو السحب
- ✅ **السحب والتحويل معطّلان** إلى أن تضبط الإدارة الأسعار وتفعّلهما

### الألعاب
- ✅ **Server-Authoritative** — كل النتائج تُحسب على السيرفر
- ✅ **Secure RNG** عبر `crypto.getRandomValues`
- ✅ **RTP configurable** لكل لعبة + لكل مستخدم
- ✅ **Forced outcomes** (win/lose) قابلة للإلغاء تلقائيًا
- ✅ **Seed لكل جولة** للتحقق
- ✅ **Coins مجانية منفصلة** ومحدودة بسقف ومكافأة يومية قابلين للتعديل

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
  2) إذا كان الشحن عبر وكيل: خصم Coins من مخزونه المدفوع مسبقًا، وإضافة المبلغ المستلم إلى سيولته النقدية
  3) deposits.status = completed
```

### السحب اليدوي
```
المستخدم → يطلب سحب
       ↓
withdrawal-request:
  1) حجز Diamonds القابلة للسحب عبر دفتر المحفظة
  2) diamond_withdrawals.status = pending
       ↓
الأدمن أو الوكيل المعيّن يحوّل للمستخدم خارجيًا
       ↓
يرفع رقم العملية + صورة الإثبات
       ↓
withdrawal-approve Edge Function:
  1) عند الدفع عبر وكيل: التحقق من سيولته النقدية وخصم صافي الدفعة
  2) تأكيد الدفع وتحديث الإحصائيات ذريًا
  (إذا رُفض: يعاد رصيد Diamonds للمستخدم ذريًا)
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
