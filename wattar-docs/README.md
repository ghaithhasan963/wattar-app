# Wattar — تطبيق صوتي اجتماعي

تطبيق صوتي اجتماعي بهوية عربية مستقلة يجمع:
- 🎙️ **غرف صوتية** (4 أو 8 مقاعد)
- 🎮 **ألعاب Point** (عجلة الحظ، نرد، Aviator، Plinko، Slots) برصيد لعب منفصل
- 🎯 **مهمات يومية** بمكافآت Point وXP يتحقق منها الخادم
- 🎁 **متجر هدايا** بأسعار Coin وتسوية هدايا موثّقة
- 💰 **ثلاث عملات واضحة**: Point للألعاب، Coin للشحن والخدمات، Diamond لأرباح الهدايا
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
يُبنى APK الاختباري عبر GitHub Actions من **Actions → Build Android APK → Run workflow**، أو تلقائيًا عند دفع نسخة معتمدة إلى `master`. يتطلب workflow أسرار المستودع `GOOGLE_SERVICES_JSON` و`EXPO_PUBLIC_SUPABASE_URL` و`EXPO_PUBLIC_SUPABASE_ANON_KEY`، ثم يحفظ ملف APK كـartifact لمدة 7 أيام.

---

## 📁 البنية

```
wattar/
├── wattar-app/              # تطبيق المستخدم (Expo + React Native)
│   ├── app/                 # شاشات التطبيق (expo-router)
│   │   ├── (auth)/          # شاشات التسجيل
│   │   ├── (tabs)/          # التبويبات الرئيسية
│   │   ├── missions.tsx     # مهمات يومية بمكافآت Point وXP
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
│       ├── admin-create-host/            # إنشاء حساب دخول أولي لمضيفة
│       ├── agent-phone-login/             # دخول الوكيل بالهاتف وكلمة المرور
│       ├── admin-manage-host/              # تعيين وإيقاف المضيفات
│       ├── admin-delete-user/              # حذف آمن أو أرشفة حساب
│       ├── admin-reset-user-password/       # إرسال رابط استعادة كلمة المرور
│       ├── room-owner-action/               # إغلاق الغرفة وإشراف المالك
│       ├── auth-send-phone-otp/              # تحديد محاولات OTP للهاتف
│       ├── auth-sign-up-email/               # تحديد محاولات التسجيل بالبريد
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
4. بعد ترحيل اقتصاد المحفظة، نفّذ `patch_three_currency_economy.sql` لإيقاف تحويل Diamond إلى Coin وإزالة الأرصدة الفرعية القديمة بقيد محاسبي.
5. نفّذ `patch_store_missions.sql` لإضافة مهمات يومية يتحقق منها الخادم ومكافآت Point وXP، مع إدارة متجر الهدايا.
6. نفّذ `patch_slots_enum.sql` منفصلًا، ثم بعد نجاحه نفّذ `patch_slots_game_config.sql` لتسجيل Slots بعملة Point فقط.
7. بعد ترحيلات المجتمع والمحفظة والغرف، نفّذ `wattar-docs/patch_admin_audit_controls.sql` لتفعيل سجل إجراءات الإدارة، ثم `wattar-docs/patch_agent_permissions.sql` بعد ترحيلات الوكلاء لتفعيل إدارة صلاحياتهم وعمولاتهم المسجلة.
8. نفّذ `wattar-docs/patch_admin_account_controls.sql` بعد سجل الإدارة، ثم `wattar-docs/patch_admin_host_management.sql` بعد `patch_host_program.sql`، وبعدهما `patch_host_pending_accounts.sql` لدعم حسابات المضيفات التي ينشئها الأدمن دون تخطي تأكيد العمر أو إكمال الملف من صاحبة الحساب.
9. نفّذ `wattar-docs/patch_room_owner_moderation.sql` بعد `patch_room_access.sql` و`patch_room_realtime.sql` و`patch_room_presence.sql`.
10. نفّذ `wattar-docs/patch_public_auth_rate_limits.sql` بعد السكيمة الأساسية وقبل نشر دوال التسجيل وطلب OTP.
11. نفّذ `wattar-docs/patch_membership_wallet_type.sql` وحده أولًا، وتأكد من نجاحه قبل تشغيل `patch_memberships_xp_acceleration.sql`؛ يضيف الثاني عضويات VIP غير متجددة تلقائيًا وسقف تسريع XP يبلغ 250 لكل عملية و500 شهريًا.
12. نفّذ `wattar-docs/patch_notification_inbox.sql` بعد ترحيلات المجتمع والمحفظة والمضيفات والعضويات.
13. بعد نجاح ترحيلات الرسائل والإشعارات، نفّذ `wattar-docs/patch_paid_messaging_wallet_types.sql` وحده وانتظر اعتماده، ثم نفّذ `wattar-docs/patch_paid_messaging.sql`. ينشئ برنامج المضيفات المستقل عن التوثيق، خمس رسائل مجانية إجمالًا لكل محادثة غير صداقة، ثم سعرًا ابتدائيًا 50 Coin لكل رسالة؛ إعدادات السعر ونسبة المضيفة (60% افتراضيًا، تدفع Diamond بنسبة 1:1) قابلة للتعديل والمدققة من لوحة الإدارة. يزرع 110 افتتاحيات، ويحد الرسائل الافتتاحية بمقدار رسالتين يوميًا لكل مستخدم مع خيار إيقافها من الخصوصية. اختبره على بيئة معاينة قبل أي تطبيق إنتاجي.
14. نفّذ `wattar-docs/patch_platform_activity_log.sql` أخيرًا بعد سجل الإدارة وجميع ترحيلات الغرف والمضيفات والمجتمع والمحفظة؛ يسجل أحداثًا تشغيلية أساسية ولا يسجل محتوى الرسائل أو بيانات الاعتماد.
15. أنشئ Storage Buckets:
   - `avatars` (عام)
   - `deposit-proofs` (خاص)
   - `withdrawal-proofs` (خاص)
   - `gift-icons` (عام)
16. أنشئ مستخدم Auth (Email/Password) للأدمن الأول:
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

لنشر دالة واحدة فقط، أضف مثلًا `-FunctionsToDeploy agent-phone-login`.

أضف متغيرات البيئة في Supabase → Settings → Edge Functions → Secrets:
- `SUPABASE_URL` (تلقائي)
- `SUPABASE_SERVICE_ROLE_KEY` (تلقائي)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` لتفعيل الصوت وقطع اتصال المتحدث عند إزالته من الغرفة. من دونها تُزال المقاعد من قاعدة البيانات، لكن لا يمكن للخادم فصل اتصال الصوت.

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
```

لبناء APK الاختبار، شغّل workflow **Build Android APK** من GitHub Actions أو ادفع النسخة المعتمدة إلى `master`. يحتاج workflow أسرار `GOOGLE_SERVICES_JSON` و`EXPO_PUBLIC_SUPABASE_URL` و`EXPO_PUBLIC_SUPABASE_ANON_KEY`، ويُتاح الناتج كـartifact لمدة 7 أيام.

---

## 🔐 الميزات الأمنية

### المحفظة
- ✅ **Append-only ledger** — لا UPDATE / لا DELETE
- ✅ **Atomic operations** عبر `record_wallet_transaction()`
- ✅ **Row Locking** لمنع الرصيد السالب
- ✅ **Idempotency keys** لمنع الازدواج
- ✅ **فصل Point وCoin وDiamond**: Point للألعاب فقط، Coin للهدايا والخدمات، وDiamond لأرباح الهدايا
- ✅ **مخزون الوكيل** لا يُضاف إلا بعد تأكيد الإدارة استلام الدفع مسبقًا
- ✅ **Point للألعاب فقط**؛ لا تُشترى ولا تتحول إلى Coin أو Diamond ولا تُسحب
- ✅ **السحب والتحويل معطّلان** إلى أن تضبط الإدارة الأسعار وتفعّلهما

### الألعاب
- ✅ **Server-Authoritative** — كل النتائج تُحسب على السيرفر
- ✅ **Secure RNG** عبر `crypto.getRandomValues`
- ✅ **RTP configurable** لكل لعبة + لكل مستخدم
- ✅ **Forced outcomes** (win/lose) قابلة للإلغاء تلقائيًا
- ✅ **Seed لكل جولة** للتحقق
- ✅ **سقف ومكافأة Point يومية** قابلان للتعديل من الإدارة

### الوصول
- ✅ **Row Level Security** على كل جدول
- ✅ **التحقق داخل الدوال المحمية** من جلسة JWT والدور؛ ودالة دخول الوكيل العامة تتحقق من بياناته وتحدّ المحاولات
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
