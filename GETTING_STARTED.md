# 🚀 Wattar — دليل التشغيل السريع

> من صفر إلى تطبيق يعمل في أقل من 15 دقيقة

---

## الخطوة 1: إنشاء Supabase (5 دقائق)

1. اذهب إلى [supabase.com](https://supabase.com) وسجّل حسابًا مجانيًا
2. اضغط **New Project** → أدخل اسمًا (مثل `wattar`) → اختر كلمة مرور → أنشئ
3. بعد جاهزية المشروع، افتح **SQL Editor** (أيقونة `>_` من القائمة الجانبية)
4. افتح الملف `wattar-docs/wattar_schema.sql` → انسخ كل محتواه → الصقه في SQL Editor → اضغط **Run**
5. من القائمة الجانبية: **Storage** → **New bucket**:
   - `avatars` → Public ✅
   - `deposit-proofs` → Private
   - `gift-icons` → Public ✅
6. احفظ هذه القيم من **Settings → API**:
   - `Project URL` (مثل: `https://abc123.supabase.co`)
   - `anon public key`

## الخطوة 2: إنشاء حساب الأدمن (2 دقيقة)

1. من القائمة: **Authentication → Users → Add user → Create new user**
2. أدخل بريدًا إلكترونيًا وكلمة مرور → Auto Confirm ✅
3. انسخ `User UUID` الخاص بالمستخدم الجديد
4. ارجع لـ **SQL Editor** ونفّذ (استبدل UUID والبريد):

```sql
INSERT INTO users (id, email, username, role, status)
VALUES ('ضع-ال-UUID-هنا', 'البريد@الإلكتروني', 'admin', 'super_admin', 'active')
ON CONFLICT (id) DO UPDATE SET role = 'super_admin', username = 'admin';
```

## الخطوة 3: نشر Edge Functions (3 دقائق)

```bash
# في مجلد wattar:
./wattar-functions/deploy-functions.sh ضع-project-ref-هنا
```

> **Project Ref** تجده في Supabase → Settings → General → Reference ID

سيطلب تسجيل دخول Supabase في المتصفح (مرة واحدة).

## الخطوة 4: تشغيل لوحة الأدمن (2 دقيقة)

```bash
cd wattar-admin

# إنشاء ملف البيئة
cat > .env.local << 'EOF'
VITE_SUPABASE_URL=ضع-Supabase-URL-هنا
VITE_SUPABASE_ANON_KEY=ضع-Anon-Key-هنا
EOF

npm install
npm run dev
```

افتح المتصفح على `http://localhost:5174` وسجّل دخول بحساب الأدمن ✅

## الخطوة 5: تشغيل تطبيق المستخدم (3 دقائق)

```bash
cd wattar-app

# إنشاء ملف البيئة
cat > .env << 'EOF'
EXPO_PUBLIC_SUPABASE_URL=ضع-Supabase-URL-هنا
EXPO_PUBLIC_SUPABASE_ANON_KEY=ضع-Anon-Key-هنا
EOF

npm install

# للتجربة على جهاز Android حقيقي:
# 1. ثبّت تطبيق "Expo Go" من متجر Google Play
# 2. على نفس شبكة WiFi:
npx expo start

# امسح QR code بتطبيق Expo Go ✅
```

## الخطوة 6: بناء APK للتحميل المباشر (اختياري)

عندما تريد إصدار APK قابل للتثبيت مباشرة (بدون Expo Go):

```bash
# مرة واحدة:
npm install -g eas-cli
eas login          # أنشئ حسابًا مجانيًا على expo.dev أولًا

cd wattar-app
eas build:configure   # يضبط المشروع
eas build -p android --profile preview

# بعد 10-15 دقيقة ستحصل على رابط تحميل APK
# شاركه مع أي شخص للتحميل والتثبيت مباشرة
```

> ملاحظة: أول مرة سيتطلب ربط حساب EAS — اضغط `projectId` في `eas build:configure` وسيضيفه تلقائيًا إلى `app.json`

---

## ✅ اختبار سريع للتأكد أن كل شيء يعمل

في لوحة الأدمن:
1. سجّل دخول → ستشاهد Dashboard
2. جرّب **Settings** → عدّل `daily_bonus_gold` إلى `1000` → احفظ
3. جرّب **Agents** → أنشئ وكيلًا جديدًا

في التطبيق:
1. سجّل دخول كزائر
2. جرّب **المحفظة** → **استلام المكافأة اليومية**
3. جرّب **الألعاب** → **عجلة الحظ** → راهن وانتهت اللعبة
4. أنشئ **غرفة جديدة** وجرّب الشات

---

## 🗺️ خريطة الملفات

```
wattar/
├── wattar-docs/
│   ├── wattar_schema.sql    ← نفّذه في Supabase (خطوة 1.4)
│   └── README.md            ← وثائق مفصلة
├── wattar-functions/
│   ├── deploy-functions.sh  ← نشر الدوال (خطوة 3)
│   └── functions/           ← 17 دالة جاهزة
├── wattar-admin/            ← لوحة الأدمن (خطوة 4)
├── wattar-app/              ← تطبيق المستخدم (خطوة 5-6)
└── wattar-shared/           ← أنواع مشتركة (لا يحتاج إعداد)
```

---

## ⚠️ حل المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| `Cannot find module '@/...'` | تأكد أن `tsconfig.json` و `babel.config.js` لديهما alias صحيح |
| Edge Function `401` | تأكد أنك أرسلت `Authorization: Bearer <token>` من التطبيق |
| التطبيق لا يتصل | تحقق من `.env` وأعد تشغيل `npx expo start -c` |
| صفحة أدمن فارغة | افتح Console في المتصفح وتحقق من أخطاء Supabase URL |
| `supabase link` يفشل | تأكد من Project Ref الصحيح وأنك مسجّل دخول `supabase login` |

---

## 📞 بعد التشغيل — ماذا بعد؟

1. **حسّن الهوية**: غيّر الألوان في `THEME_COLORS` (wattar-shared) و`tailwind.config.js` (admin)
2. **أضف هدايا**: جدول `gifts` — أدخل صفوفًا جديدة مع أيقونات Lottie
3. **اضبط الاقتصاد**: من لوحة الأدمن → Settings → RTP والأسعار
4. **أنشئ وكلاء**: من لوحة الأدمن → Agents
5. **للنشر على Google Play**: عندك `eas.json` جاهز لـ production bundle

---

**Wattar v1.0.0** — جاهز للتشغيل 🎉
