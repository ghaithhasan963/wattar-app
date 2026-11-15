# نتائج التدقيق — Wattar (2026-11-14)

**النطاق:** `wattar-app` · `wattar-admin` · `wattar-functions` · `wattar-docs/*.sql` · `.github/workflows`
**الطريقة:** قراءة فقط. لا ملفات معدّلة. كل ادعاء مرفق بموضع (ملف:سطر) كي يمكن التحقق منه.
**الحالة:** تدقيق التطبيق واللوحة مكتمل. تدقيق القاعدة والدوال جزئي (تم التحقق من النقاط الحرجة يدوياً وأُشير إلى ما لم يُتحقق).

---

## 1) تطبيق الهاتف — 39 مساراً (~12,700 سطر)

### 1.1 ثغرات وثقة زائدة في العميل

| # | الملاحظة | الموضع | الحقيقة الكاملة |
|---|---|---|---|
| 1 | الشات يُكتب من العميل بهوية من الحالة المحلية | `app/room/[id].tsx:383-391` | **RLS تمنع الانتحال** (`auth.uid() = user_id` في `wattar_schema.sql:1131-1142`)، لكن لا اختبار يثبت أن النسخة الحيّة تحمل هذه السياسة |
| 2 | المقاعد تُحدَّث بمعرّف الصف فقط | `app/room/[id].tsx:443-451, 490-493` | سياسة `room_seats_claim` تمنع أخذ مقعد مشغول (`wattar_schema.sql:1110-1120`)، لكنها تعتمد على أن الصف ليس لغيرك |
| 3 | سعر الرسالة المدفوعة يُرسل من العميل | `app/messages/[id].tsx:210-215` | يجب أن يُعاد حسابه خادمياً؛ لا يوجد ما يثبت تحقق الخادم |
| 4 | كلمة مرور الغرفة نص صريح ولا تُطلب عند الدخول | `app/room/create.tsx:35-55` + غيابها في `app/room/[id].tsx` | `rooms.password VARCHAR(50)` في `wattar_schema.sql` — أمان زائف |
| 5 | `recover-password` بلا تحقق من جلسة استعادة | `app/recover-password.tsx:22-43` | أي شخص بجهاز مفتوح يغيّر كلمة المرور |
| 6 | `select('*')` على `users` | `src/store/auth.ts:297-301` | يسحب الهاتف/البريد/الإجماليات إلى العميل |
| 7 | رفع الصور إلى bucket عام + `upsert` بلا حدّ حجم | `src/lib/supabase.ts:59-90` | قراءة Base64 كاملة في الذاكرة (`atob`) |
| 8 | `send_host_intro_batch` من كل عميل كل 6 ساعات | `app/_layout.tsx:132,142` | سطح إزعاج/استنزاف إن لم تُقيَّد الـRPC |
| 9 | `set_my_presence` كل 60 ثانية لكل مستخدم | `app/_layout.tsx:116` | 1440 كتابة/يوم/مستخدم |

### 1.2 أخطاء وظيفية مؤكدة

| # | الخطأ | الموضع |
|---|---|---|
| 10 | Slots يبقى «جاري…» إذا قُوطعت الأنيميشن | `app/game/slots.tsx:84-97` |
| 11 | Dice يعرض RTP 30% محسوباً محلياً بينما الخادم يملك `admin-set-rtp` | `app/game/dice.tsx:38-43` |
| 12 | المهام: قسمة على `target_count` بلا حماية ⇒ `NaN%` | `app/missions.tsx:135` |
| 13 | `complete-profile` ينتقل قبل تثبيت `adult_confirmed_at` ⇒ ارتداد | `app/(auth)/complete-profile.tsx:56-57` |
| 14 | فشل Signed URL واحد يُسقط كل الصور (N+1) | `app/user/[id].tsx:133-139`, `app/stories.tsx:58-66` |
| 15 | Regex مسار الإشعارات هشّ (`[0-9a-f-]{27}`) ويفشل بصمت | `app/(tabs)/notifications.tsx:195` |
| 16 | راوتر إشعارات مكرر بمنطقين مختلفين | `app/_layout.tsx:75-88` مقابل `notifications.tsx:191-198` |
| 17 | `callFunction` بلا مهلة؛ أي استجابة غير JSON تنتج `SyntaxError` غامض | `src/lib/supabase.ts:36-55` |

### 1.3 أداء وسباقات
- كل حدث Realtime في الأصدقاء يستدعي 6 RPCs كاملة (`friends.tsx:142-167`)؛ كل رسالة تعيد تحميل المحادثة (`messages/[id].tsx:118-127`)؛ `agent-group` Polling كل 10 ثوان (`agent-group.tsx:133-141`).
- قناتان Realtime لنفس الجدول (`NotificationBell` + شاشة الإشعارات).
- `ScrollView.map` بدل `FlatList`؛ لا `expo-image`؛ لا Pagination.

### 1.4 i18n وRTL
لا `I18nManager` ولا طبقة ترجمة. 25 موضع `paddingTop` ثابت (54–62). ثلاث طرق لتنسيق الأرقام. أيقونات رجوع بأربعة اتجاهات. تسمية عملات مختلطة (Coin/Coins/gold/Point/نقطة).

### 1.5 ديون تقنية
`updateBalance` كود ميت (`src/store/auth.ts:67,354-363`) · `src/hooks` و`src/types` فارغان · 8نسخ ألوان محلية بدل `theme.ts` · Idempotency مكرر 6 مرات · ~140 `Alert.alert` كنماذج تفاعل · فجوة دلالية بين واجهة Coin/Diamond/Point وقاعدة `balance_gold`/`balance_diamond`/`game_points`.

---

## 2) لوحة الإدارة — 21 ملفاً

**نتيجة مهمة:** الحرّاس الخلفية سليمة. كل `admin-*` تستدعي `authenticate` + `requireRole`، وتقييد الوكيل على عملائه منفّذ داخل `deposit-approve`/`withdrawal-approve`، والشحن عبر RPC بـidempotency وتدقيق. الخطر في **الطبقة البشرية والنقرة الخاطئة**، لا في غياب الحارس.

| # | الملاحظة | الموضع |
|---|---|---|
| 18 | **حقن PostgREST**: `.or()` يُبنى بسلسلة تحتوي إدخال المستخدم | `pages/UsersPage.tsx:59-65` |
| 19 | لا إدارة موظفين/أدوار: منح `admin` يدوي في القاعدة بلا سجل | `App.tsx:95-245`, `components/Layout.tsx:37-82` |
| 20 | تدقيق تجميلي: `before`/`after` كاملة تُرسل للمتصفح | `pages/AuditLogPage.tsx:36-52, 87-101` |
| 21 | موافقة إيداع بضغطة واحدة، رفض بـ`window.prompt`, زر رفض بلا `disabled` | `DepositsPage.tsx:158-180, 271-291`, `WithdrawalsPage.tsx:240-265` |
| 22 | سجلات عالقة في `reviewing` (RPC يقبلها، الواجهة لا تعرضها) | `WithdrawalsPage.tsx` |
| 23 | لا تفاصيل مستخدم ولا دفتر محفظة ولا تسوية رصيد بسبب | `UsersPage.tsx:347-649` |
| 24 | البلاغات والتحويلات للقراءة فقط | `UserReportsPage.tsx`, `TransfersPage.tsx` |
| 25 | `p_assigned_to` يُكتب في كل تغيير حالة ⇒ يمحو التعيين | `SupportPage.tsx:153-171` |
| 26 | تحويل هيوريستي يخرّب JSONB (`"1.0"`, `"03"`, `"true "`) | `SettingsPage.tsx:59-100` |
| 27 | حالة modal لا تُعاد تهيئتها عند تغيير المستخدم | `UsersPage.tsx:566-579` |
| 28 | الحالة تُغيَّر عبر `admin-delete-user` بحقل `action:'status'` بينما `admin-set-user-status` مهجور | `UsersPage.tsx:104-131` |
| 29 | لا `onAuthStateChange` ⇒ جلسة/دور قديمان | `store/auth.ts:64-83` |
| 30 | `callFunction` بلا timeout/retry/401 | `lib/supabase.ts:27-52` |
| 31 | `transfers` و`user_reports` و`profiles` بلا تدقيق trigger | `patch_admin_audit_controls.sql:225-244` |
| 32 | سجل التدقيق `limit 200` بلا ترقيم | `AuditLogPage.tsx:70` |
| 33 | `bg-dark-bg` صنف غير موجود؛ `StatCard` و`react-query` بلا استخدام | `MessagingPage.tsx:216,278,336,385` |

---

## 3) الدوال والقاعدة — تحقق جزئي

### 3.1 مصادقة الدوال (تم التحقق)
- 34 دالة، **30 منها تستدعي `authenticate()`**، و`delete-account` تتحقق بـ`getUser()` يدوياً.
- الاستثناءات العامة بطبيعة الحال: `auth-sign-up-email`, `auth-send-phone-otp`, `agent-phone-login` (تسجيل دخول)، و`transfer` (تُعيد `410` دائماً).
- كل `admin-*` + `deposit-approve` + `withdrawal-approve` تستخدم `authenticate` + `requireRole`.

⇒ **تصحيح:** المخاطرة ليست «دوال مفتوحة»، بل **عدم إثبات أن النسخة المنشورة مطابقة للمصدر**، و**سياسات RLS على الجداول التي يكتبها العميل مباشرة**.

### 3.2 RLS على جداول الغرف (تم التحقق من المخطط)
- `room_messages_insert`: تفرض `auth.uid() = user_id` وتمنع `is_system` (`wattar_schema.sql:1131-1142`).
- `room_seats_claim`: تسمح بتحديث المقعد الفارغ أو مقعدك فقط (`:1110-1120`)، مع منح أعمدة محدّدة فقط (`GRANT UPDATE (user_id, status, is_mic_on, joined_at)`).
- الغرف الخاصة: `NOT is_private OR owner_id = auth.uid()` تعني أن غير المالك لا يرى المقاعد/الرسائل — تُعالجها سياسات الدعوات في `patch_social_foundation.sql:187-224`.

### 3.3 ما لم يُتحقق (يحتاج A0)
- أي `patch_*.sql` مطبّق فعلاً على المشروع `vczyjbqixqzositlkfkn`.
- سياسات Storage (avatars عام، stories/posts/private عبر Signed URLs).
- تفعيل Realtime على الجداول المستخدمة.
- أسرار LiveKit وFCM وحالة SMTP — لا يمكن قراءتها من المصدر.
- حالة `public_auth_rate_limits` مقابل الحدّ في ذاكرة الـisolate.

---

## 4) الخلاصة
المنتج في واجهاته أبعد مما تظن، وفي أمانه أفضل مما بدا في أول قراءة للعميل (RLS قوية في المخطط)، لكنه **غير مُثبت على أي مستوى**: لا اختبارات، ولا مطابقة بين المصدر والمنشور، ولا بوابة تمنع كسر `master`.
