# خطة تطبيق `patch_paid_messaging.sql` — قرار المدير 2026-11-14
**القرار:** تطبيق الـpatch بعد نسخة احتياطية.
**الحالة:** ✅ **مطبّق بالكامل 2026-11-14** عبر `npx supabase db query --remote=vczyjbqixqzositlkfkn` (بعد فشل اللصق اليدوي في محرر SQL — انظر القسم ٦٫١). قيمتا الـenum والـpatch الأساسي والمتابعة المتبادلة كلها **مطبّقة**، والتحقق البنيوي **نجح** (القسم ٦٫٢).
**المرجع:** §20 من `المطلوب تماما .txt` (الأسطر 968–981: الأصدقاء مجاناً بلا حد، وغير الأصدقاء حد مجاني لكل محادثة ثم رسوم Coin يضبطها الأدمن).
**قرار المدير الإضافي (2026-11-14):** **المتابعون المتبادلون** أيضاً مجاناً بلا حد مثل الأصدقاء. لذلك يُطبّق بعد الـpatch الأساسي ملف `patch_paid_messaging_followers.sql` (الخطوة ٣٫٥).

---

## 0) نتيجة الفحص التمهيدي — 2026-11-14 17:55 (PostgreSQL 17.11)

| # | الفحص | النتيجة | الحكم |
|---|---|---|---|
| 1 | `missing_enum_values` | `["message_sent", "message_commission"]` | **❌ العائق الوحيد** → يلزم `patch_paid_messaging_wallet_types.sql` أولاً |
| 2 | `new_tables_that_already_exist` | `[]` | ✅ لا تطبيق جزئي سابق |
| 3 | `functions_to_be_created_already_exist` | `[]` | ✅ لا تعارض أسماء |
| 4 | `functions_that_will_be_dropped` | ٣ دوال، `dependents = 0` | ✅ الحذف آمن |
| 5 | `constraint_user_notifications_event_type` | مطابق حرفياً للقائمة الجديدة (١٢ قيمة) | ✅ الاستبدال لا يغيّر شيئاً |
| 6 | `user_notifications_event_unique` | `UNIQUE (user_id, event_type, reference_id)` | ✅ `ON CONFLICT` سيعمل |
| 7 | `private_conversation_unique_pair` | `UNIQUE (user_one_id, user_two_id)` | ✅ `ON CONFLICT` سيعمل |
| 8 | `record_wallet_transaction` | ١٠ وسائط مطابقة تماماً | ✅ |
| 9 | `is_admin()` · `is_wattar_blocked_between(uuid)` · `gen_random_uuid()` | موجودة | ✅ |
| 10 | `audit_action_type` | يحوي `create/update/approve/suspend` | ✅ |
| 11 | `admin_audit_log` | `target_id uuid` · `before/after/metadata jsonb` | ✅ |
| 12 | `wallet_transactions.currency` | `varchar` (يقبل `gold`/`diamond`) | ✅ |
| 13 | أعمدة `private_messages` | لا تحتوي الأربعة المطلوبة | ✅ ستُضاف |
| 14 | `users` | لا يحتوي `host_message_opt_out` | ✅ سيُضاف |
| 15 | `event_types_in_use` | `deposit_update`, `host_update` | ✅ داخل القائمة الجديدة |
| 16 | حجم البيانات | ٣ رسائل · محادثة واحدة · ٦ إشعارات · ١ صداقة | ✅ أثر صفر |

**ملاحظة أمنية إيجابية:** الـACL الحالي للدوال الثلاث يُظهر `anon=X` — أي أن الزوّار يستطيعون استدعاءها الآن (تُفشلهم `auth.uid()` لكنها صلاحية زائدة). الـpatch يحذفها ويعيد إنشاءها، فتنظف الصلاحية تلقائياً.

**النتيجة:** الـpatch **جاهز للتطبيق** بعد خطوة واحدة: إضافة قيمتَي الـenum.

---

## 1) لماذا هذا الـpatch بالذات؟

لأنه الملف الوحيد غير المطبّق، وهو سبب تعطّل المحادثة الخاصة فعلياً:

| الأثر الحالي | السبب |
|---|---|
| شاشة المحادثة لا تُحمّل | `get_private_message_quote` غير موجودة |
| الإرسال يفشل | `send_private_message` المنشورة ٢ وسائط، والواجهة ترسل ٤ |
| صفحة المراسلة في اللوحة معطّلة | ٧ دوال `admin_*` غير موجودة |
| إعدادات المضيفة لا تعمل | `get/set_my_host_outreach_preference` غير موجودة |
| ملف المستخدم يفشل جزئياً | `is_wattar_host_program_member` غير موجودة |
| مهمة الافتتاحيات تفشل بصمت | `send_host_intro_batch` غير موجودة |

---

## 2) ما الذي يفعله الـpatch بالتحديد

### أ) كائنات جديدة (لا تمسّ بيانات موجودة)

| النوع | الكائن |
|---|---|
| ٤ جداول | `host_program_members` · `private_message_settings` · `host_intro_templates` · `host_outreach_deliveries` |
| ٣ فهارس | `idx_host_program_members_status` · `idx_host_outreach_recipient_day` · `idx_private_messages_idempotency` |
| ١٥ دالة | ١٢ المفقودة + `send_private_message` (٤ وسائط) + `create_private_conversation` + `list_private_messages` |
| عمود على `users` | `host_message_opt_out` |
| ٤ أعمدة على `private_messages` | `charged_coins` · `host_commission_diamonds` · `sender_is_host_at_send` · `idempotency_key` |
| بيانات أولية | إعدادات رسائل افتراضية + **١١٠** افتتاحية عربية للمضيفات |

### ب) ما يغيّره فعلياً على الموجود

| العملية | الأثر | الحكم |
|---|---|---|
| استبدال قيد `user_notifications_event_type_check` | يضيف `host_earning` و`support_reply` | آمن — القائمة الحالية مطابقة لنفس القائمة في `patch_support_tickets.sql` |
| `DROP FUNCTION send_private_message(uuid,text)` | تختفي النسخة القديمة | **مقصود** — التوقيع الجديد يحلّ مكانها |
| `DROP + CREATE` لـ`create_private_conversation` و`list_private_messages` | نفس الأسماء، تعريف أحدث | لا فقدان بيانات |
| `BEGIN` … `COMMIT` | الملف كله معاملة واحدة | أي خطأ = **لا شيء يُطبّق** |

**لا يوجد أي `DELETE` أو `TRUNCATE` أو حذف جدول أو مسح بيانات.**

---

## 3) الخطوات — بالترتيب، لا تُتجاوز

### الخطوة ٠ — النسخة الاحتياطية (أنت، على جهازك)

النسخة الاحتياطية القابلة للتنزيل **ليست مضمونة على الخطة المجانية** في Supabase، لذلك لا نعتمد على نسخ المنصّة: نسحبها بأنفسنا من جهازك عبر Supabase CLI (مثبّت ومُتحقق: `v3.1.0`).

```powershell
# داخل مجلد المشروع
New-Item -ItemType Directory -Force -Path "C:\Users\2025\Backups\wattar" | Out-Null

# 1) المخطط (schema) — بلا بيانات
npx supabase db dump --remote --schema public `
  -f "C:\Users\2025\Backups\wattar\2026-11-14_schema_before_paid_messaging.sql"

# 2) البيانات — بلا مخطط
npx supabase db dump --remote --data-only --schema public `
  -f "C:\Users\2025\Backups\wattar\2026-11-14_data_before_paid_messaging.sql"
```

- سيطلب كلمة سر قاعدة البيانات. **لا ترسلها لي ولا تحفظها في المستودع.**
- إن طلب تسجيل الدخول: `npx supabase login` (مجاني، يفتح المتصفح).
- احفظ الملفين **خارج مجلد المشروع** (كما في المسار أعلاه) حتى لا يُرفعا إلى GitHub.
- تحقّق من نجاح السحب:

```powershell
Get-ChildItem "C:\Users\2025\Backups\wattar" | Select-Object Name, Length
Select-String -Path "C:\Users\2025\Backups\wattar\2026-11-14_schema_before_paid_messaging.sql" -Pattern "CREATE TABLE public.users" -SimpleMatch
```

**شرط الانتقال:** الملفان موجودان، وحجم المخطط أكبر من 50KB، وسطر `CREATE TABLE public.users` موجود.

> إن فشل `--remote` بسبب كلمة السر: أعد ضبطها من Supabase → Project Settings → Database → Reset database password، ثم أعد الأمر. لا تحتاج أي دفع.
>
> **بديل لو فشل CLI نهائياً (مجاني أيضاً):** نزّل حزمة PostgreSQL portable لـWindows من `postgresql.org/download/windows/`، ثم:
> ```powershell
> pg_dump --schema-only --schema=public --no-owner --no-privileges `
>   -f "C:\Users\2025\Backups\wattar\2026-11-14_schema_before_paid_messaging.sql" `
>   "<DATABASE_URI>"
> ```
> استخدم `-f` ولا تستخدم `>` (PowerShell يكتب UTF-16 فيفسد الملف). الـ`DATABASE_URI` من Supabase → Project Settings → Database → Connection string → URI. لا تكتبه هنا.

---

### الخطوة ١ — الفحص التمهيدي (أنت)

افتح Supabase → SQL Editor → الصق كل محتوى:

```
wattar-docs/diagnostics/01_paid_messaging_preflight.sql
```

ثم Run وأرسل لي الناتج (JSON) كما هو. لا يحتوي أي سر.

**لن أنتقل للخطوة ٣ قبل أن أقرأ هذا الناتج.**

---

### الخطوة ٢ — إضافة قيمتَي الـenum (مؤكد مطلوبة)

الفحص أثبت أن `wallet_tx_type` **لا يحتوي** `message_sent` ولا `message_commission`. لذلك نطبّق أولاً:

```
wattar-docs/patch_paid_messaging_wallet_types.sql
```

وهو ملف قصير (سطران) يضيف القيمتين. **يُشغَّل وحده، في استعلام منفصل** — لأن PostgreSQL لا يسمح باستخدام قيمة enum أُضيفت في نفس المعاملة.

بعد تشغيله: أعد تشغيل `01_paid_messaging_preflight.sql` وتأكد أن:

- `missing_enum_values` = `[]`
- `enum_wallet_tx_type` يحوي `message_sent` و`message_commission`

عندها فقط ننتقل للخطوة ٣.

---

### الخطوة ٣ — التطبيق (أنت)

1. Supabase → SQL Editor → New query.
2. الصق **كل** محتوى `wattar-docs/patch_paid_messaging.sql` (٨٤٨ سطراً) كما هو — لا تعدّل سطراً.
3. Run.
4. النتيجة المتوقعة: `Success. No rows returned`.
5. **إن ظهر أي خطأ:** انسخ نص الخطأ كاملاً وأرسله. لا تعِد المحاولة ولا تشغّل تعديلات يدوية — الملف معاملة واحدة، أي خطأ يعني أن **لا شيء** تغيّر.

---

### الخطوة ٣٫٥ — قاعدة المتابعة المتبادلة (أنت)

بعد نجاح الخطوة ٣ (وبعد الخطوة ٤ إن أردت التحقق أولاً)، شغّل ملفاً منفصلاً في استعلام جديد:

```
wattar-docs/patch_paid_messaging_followers.sql
```

- يستبدل دالتين فقط: `get_private_message_quote(uuid)` و`send_private_message(uuid,text,text,bigint)`.
- يضيف شرط **المتابعة المتبادلة** (`user_follows` في الاتجاهين) إلى جانب الصداقة.
- لا يمسّ أي جدول أو عمود أو بيانات، ولا يغيّر التوقيعات (لا حاجة لإعادة بناء APK بسبب هذا الملف).
- مُتحقَّق نحوياً بمحلّل PostgreSQL الفعلي (`libpg_query`): ٨ عبارات صالحة. آمن للإعادة.
- النتيجة المتوقعة: `Success. No rows returned`. أي خطأ = لم يتغيّر شيء (الملف `BEGIN`/`COMMIT`).

**سياسة الرسائل النهائية بعد هذا الملف:**

| العلاقة | الحالة |
|---|---|
| صديق مقبول | مجاني بلا حد |
| متابع متبادل | مجاني بلا حد |
| المُرسِل مضيف معتمد | مجاني بلا حد |
| أي حالة أخرى | أول `free_message_limit` رسالة مجانية، ثم `price_coin` Coin لكل رسالة |

---

### الخطوة ٤ — التحقق البعدي (أنت)

شغّل `wattar-docs/diagnostics/02_paid_messaging_verify.sql`:

- **الاستعلام ١** يجب أن يكون كله `true`، و`old_send_private_message_2arg_still_exists = false`، و`policy_count_on_new_tables = 0`، و`direct_grants_to_authenticated = 0`.
- **الاستعلام ٢** (المعلّق في الملف) يكشف عدد الافتتاحيات والإعدادات — شغّله بعد نجاح الأول.

---

### الخطوة ٥ — اختبار وظيفي على جهازين

هذا هو الشرط الحقيقي في §20: **«اختبر دورة المحادثة كاملة من حسابين مختلفين»**. الاختبار البنيوي لا يكفي.

| # | الاختبار | المتوقع |
|---|---|---|
| 1 | فتح قائمة المحادثات | تظهر بلا خطأ |
| 2 | فتح محادثة | تُحمّل الرسائل + يظهر عدّاد المجاني |
| 3 | إرسال رسالة كصديق | مجانية، بلا خصم |
| 3ب | إرسال رسالة لمتابع متبادل (بلا صداقة) | مجانية، بلا خصم |
| 4 | إرسال رسالة لغير صديق | أول ٥ مجانية ثم ٥٠ Coin |
| 5 | رصيد غير كافٍ | رسالة خطأ عربية واضحة، بلا خصم |
| 6 | إرسال بنفس مفتاح التكرار | لا تتكرر الرسالة |
| 7 | استقبال الطرف الآخر | يصل فوراً (Realtime) |
| 8 | حجب الطرف | تختفي المحادثة ويفشل الإرسال |
| 9 | لوحة الإدارة → المراسلة | الإعدادات تُقرأ وتُحفظ |
| 10 | حساب غير مضيف | لا تصله افتتاحيات |

الاختبار يحتاج إعادة بناء APK وتثبيته (الكود الحالي يطابق التوقيع الجديد). لن أطلب بناءً الآن — بعد نجاح الخطوات ١–٤.

---

## 4) التراجع (Rollback)

| المستوى | الطريقة | متى |
|---|---|---|
| **الأول — استعادة كاملة** | إعادة المخطط + البيانات من نسخة الخطوة ٠ | إذا ظهر خلل جسيم |
| **الثاني — تراجع سريع للدوال** | إعادة تعريف الدوال الثلاث من `patch_social_foundation.sql` (الأسطر 404–553) — هي النسخ الأصلية | إذا تعطّلت المحادثة بعد التطبيق |
| **الثالث — تخفيف الرسوم بلا كود** | من لوحة الإدارة: ارفع `free_message_limit` إلى **١٠٠** (أقصى قيمة يسمح بها القيد). الرسوم لا تُلغى تماماً — الحد الأدنى للسعر ١ Coin — لكنها تصبح نادرة. الإلغاء الكامل يحتاج migration بقرارك | إذا اعترضت على التسعير مؤقتاً |

> ملاحظة: الجداول والأعمدة الجديدة **تبقى** بعد التراجع الثاني. لا حذف، ولا فقدان بيانات. حذفها يحتاج migration مستقلّاً بقرارك.

---

## 5) المخاطر المعروفة قبل التطبيق

| # | الخطر | الأثر | التخفيف |
|---|---|---|---|
| 1 | حذف `send_private_message(uuid,text)` | أي APK قديم مثبّت يفقد الإرسال | لا إطلاق عام بعد؛ إعادة بناء وتثبيت بعد التطبيق |
| 2 | الـpatch يستخدم `balance_gold` كـ«Coin» | تسمية داخلية فقط | لا أثر على المستخدم؛ توحيد التسمية في M3 |
| 3 | `LIMIT 200` بلا Pagination | محادثة أطول من ٢٠٠ رسالة تُقصّ | مسجّل لـM9 (الملف يطلب Pagination صراحةً) |
| 4 | عدّاد المجاني محسوب على المحادثة كلها (الطرفان) | قد يستهلك الطرفان ٥ رسائل معاً | قرار منتج — أرفعه لك في M9 |
| 5 | الإعدادات الافتراضية: ٥ مجانية · ٥٠ Coin · عمولة ٦٠٪ · افتتاحيتان يومياً | قد لا تطابق سياستك | قابلة للتغيير من اللوحة، وبدون كود |
| 6 | تفعيل برنامج المضيفات لاحقاً | أول فتح للتطبيق قد يرسل افتتاحيات فعلية | الآن الجدول فارغ → لا يُرسل شيء |
| 7 | `host_intro_templates` فيه ١١٠ جملة عربية جاهزة | قد لا تناسب نبرة المشروع | تراجعها أنت في M8/M9 قبل التفعيل |

---

## 6) قرارات حُسمت مع هذه الدفعة (2026-11-14)

| # | القرار | النتيجة |
|---|---|---|
| 1 | الإعدادات الافتراضية | ✅ معتمدة: ٥ رسائل مجانية · ٥٠ Coin · عمولة ٦٠٪ · افتتاحيتان يومياً |
| 2 | عمولة المضيفة ٦٠٪ | ✅ معتمدة |
| 3 | `transfers` | ✅ **يبقى معطّلاً** (لا INSERT policy، و`transfer` RPC يعيد `410`). يُوثّق كإرث ويُراجع في M3. لا حذف. |
| 4 | المتابعون المتبادلون | ✅ مجاناً بلا حد مثل الأصدقاء (الخطوة ٣٫٥) |

### 6٫1) التطبيق الفعلي — 2026-11-14 (كيف تم)

محرر SQL في اللوحة كان يقطع اللصق حول السطر ١٠١ من كلتا الملفين (نقصان تلفيقاً / `dollar-quoted string غير مكتمل`)، فطُبّق كل ملف كاستعلام واحد عبر Supabase CLI:

```powershell
npx supabase db query --remote=vczyjbqixqzositlkfkn `
  -f "wattar-docs/patch_paid_messaging.sql" --yes
```

- لا حاجة لـApp token يدوي: الـCLI مسجّل دخوله من جهاز المدير.
- قبل التطبيق تم التحقق أن المحلّل الفعلي يقبل الملفين (`pgsql-parser`: ٧٣ و٨ عبارات صالحة)، وأن لا شيء مطبّق جزئياً (`host_program_members` وغيرها غير موجودة).
- النتيجة: **كلاهما نُفّذ بدون أي خطأ إرجاع.**

### 6٫2) التحقق البعدي الفعلي — 2026-11-14 (Read-only)

النتيجة الكاملة من `02_paid_messaging_verify.sql`:

```json
{
  "tables_exist": {"host_program_members": true, "private_message_settings": true, "host_intro_templates": true, "host_outreach_deliveries": true},
  "rls_enabled": {all true},
  "functions_exist": {all true, incl. "send_private_message_4arg": true},
  "security_definer": {all true},
  "seed_templates_count": 110,
  "users_new_column_exists": true,
  "private_messages_new_columns": ["charged_coins", "host_commission_diamonds", "sender_is_host_at_send", "idempotency_key"],
  "policy_count_on_new_tables": 0,
  "direct_grants_to_authenticated": 0,
  "old_send_private_message_2arg_still_exists": false,
  "old_send_private_message_3arg_still_exists": false,
  "constraint_user_notifications_event_type": "CHECK ((event_type = ANY (ARRAY['friend_request'::text, 'friend_accepted'::text, 'private_message'::text, 'room_invitation'::text, 'new_follower'::text, 'gift_received'::text, 'deposit_update'::text, 'withdrawal_update'::text, 'host_update'::text, 'membership_update'::text, 'host_earning'::text, 'support_reply'::text])))"
}
```

وفحص `private_message_settings`: `free_limit=5 · price_coin=50 · commission=60 · intro_limit=2`. و`get_private_message_quote` تحتوي منطق المتابعة المتبادلة (`is_mutual_follow`)، و`send_private_message` تفرض القاعدة عبر `v_mutual_follows` (شرط الاتجاهين في `user_follows`).

---

## 7) ما أتوقعه منك الآن — باختصار

الخطوات ٠–٤ **منجزة**: النسخة الاحتياطية، الفحص، قيمتا الـenum، تطبيق الـpatch الأساسي وملف المتابعة المتبادلة، والتحقق البنيوي كله **نجح**. المتبقي فقط:

1. إعادة بناء APK وتثبيته (الكود الحالي في `app/messages/[id].tsx` يطابق التوقيع الجديد).
2. اختبار الحسابين (الخطوة ٥): فتح المحادثة، العداد، ٥ مجانية ثم ٥٠ Coin، التأكيد قبل الخصم، الحجب، لوحة الإدارة.

---

## 8) ملفات هذه الدفعة

| الملف | الغرض |
|---|---|
| `wattar-docs/diagnostics/01_paid_messaging_preflight.sql` | فحص قراءة فقط قبل التطبيق |
| `wattar-docs/diagnostics/02_paid_messaging_verify.sql` | تحقق بنيوي بعد التطبيق |
| `wattar-docs/PLAN_APPLY_PAID_MESSAGING.md` | هذا الملف |
| `wattar-docs/patch_paid_messaging_followers.sql` | إضافة المتابعة المتبادلة (الخطوة ٣٫٥) |
