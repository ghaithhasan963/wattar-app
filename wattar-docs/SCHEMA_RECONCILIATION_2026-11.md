# مطابقة المخطط مع قاعدة البيانات الفعلية — M0.2
**التاريخ:** 2026-11-14 · **المصدر:** ناتج `diagnostics/00_environment_probe.sql` الذي شغّلته على مشروع `vczyjbqixqzositlkfkn` · **الطريقة:** قراءة فقط، بلا أي كتابة.
**المرجع:** `SCHEMA_MANIFEST.md` (الجرد من الملفات) + `المطلوب تماما .txt`.

> هذا الملف يجيب سؤالاً واحداً بدقة: **ما هو موجود فعلاً في قاعدة البيانات، وما الفرق بينه وبين ما تقوله ملفات SQL وبين ما يطلبه الملف المرجعي.**
> كل رقم هنا مأخوذ من ناتج الاستعلام أو من مسح آلي للمستودع، وليس تخميناً.

---

## 1) الخلاصة التنفيذية

| البند | النتيجة |
|---|---|
| جداول في قاعدة البيانات الفعلية | **٥٧ جدولاً** (`public`) |
| جداول معرّفة في SQL المعتمد | **٦١ جدولاً** |
| جداول ناقصة فعلاً | **٤ جداول** — كلها من `patch_paid_messaging.sql` |
| جداول زائدة (في القاعدة وليست في SQL) | **صفر** |
| RLS مفعّل | **٥٧ / ٥٧** |
| جداول RLS مفعّل بلا أي policy | **١٩ جدولاً** — كلها تعمل عبر دوال `SECURITY DEFINER` (بالتصميم، ليست خطأ) |
| جداول RLS معها policy واحدة أو أكثر | **٣٨ جدولاً** |
| دوال تطبيقية منشورة | **١٢٣ دالة** (١١٥ `SECURITY DEFINER` + ٨ `INVOKER`)، بعد استثناء دوال الامتدادات |
| Storage buckets | **٦** (الكود يستخدم ٤، والقاعدة فيها ٢ إضافيتان) |
| جداول Realtime | **٩** |
| الامتدادات | **٧** |
| مستخدمو Auth | **١٨** |
| أعمدة المحفظة في `users` | **٧** (٥ أرصدة + طابعان زمنيان) |

**الحكم:** المخطط **مطبّق بالكامل تقريباً**. الاستثناء الوحيد المؤكد هو **`patch_paid_messaging.sql` غير مطبّق**، وهذا ليس تفصيلاً نظرياً: **الواجهة تنادي ١٢ دالة غير موجودة، وشاشة المحادثة الخاصة معطّلة فعلياً** (التفصيل في القسم ٦).

---

## 2) الجداول: مطبّق / ناقص / زائد

### ٢.١ الجداول الـ٤ الناقصة (كلها من `patch_paid_messaging.sql`)

| الجدول | الغرض في الملف | الأثر الحالي |
|---|---|---|
| `private_message_settings` | إعدادات تسعير الرسائل الخاصة والحد المجاني | غير موجود |
| `host_program_members` | عضوية برنامج المضيفات (منفصل عن التوثيق) | غير موجود |
| `host_intro_templates` | قوالب تعريف المضيفات | غير موجود |
| `host_outreach_deliveries` | سجل رسائل التواصل مع المضيفات | غير موجود |

**دليل إضافي:** ناتج Probe لا يحتوي أي دالة من دوال هذا الملف (مثل `admin_get_private_message_settings`، `get_private_message_quote`، `set_my_host_outreach_preference`). إذاً الملف **لم يُطبّق إطلاقاً**، لا جزئياً.

### ٢.٢ الجداول الزائدة
**صفر.** كل جدول في القاعدة معرّف في SQL المعتمد. لا يوجد «جدول يتيم» أُنشئ يدوياً خارج الملفات.

### ٢.٣ ملاحظة على العدّ
`SCHEMA_MANIFEST.md` ذكر ٦٢ جدولاً لأن مسحه شمل مجلد `التعديل الجديد للمشروع/` المهمَل (gitignored) الذي يحتوي `user_devices`. المسح المعتمد الآن (جذر المشروع + `wattar-docs/`) يعطي **٦١**، وهي القيمة الصحيحة.

---

## 3) RLS: ٥٧ مفعّل، ١٩ بلا policy — والتفسير

### ٣.١ جداول بلا policy (١٩) — وصولها عبر RPC فقط

هذه ليست ثغرة بحد ذاتها: RLS مفعّل، ولا يوجد policy، إذاً أي وصول مباشر من `anon`/`authenticated` يُرفض. الوصول الشرعي يمر عبر دوال `SECURITY DEFINER` أو `service_role`.

| الجدول | كيف يُستخدم شرعياً |
|---|---|
| `account_cleanup_storage` | `service_role` فقط (تنظيف حسابات) |
| `agent_groups` · `agent_group_memberships` · `agent_group_messages` | دوال `list_agent_group_*` / `send_agent_group_message` |
| `game_points_ledger` | `play_game_with_points` / `claim_daily_game_points` |
| `otp_codes` | دوال Edge / `service_role` |
| `progress_events` | `award_user_xp` / `daily_mission_progress` |
| `public_auth_rate_limits` | `consume_public_auth_rate_limits` |
| `push_tokens` | `register_my_push_token` / `remove_my_push_token` |
| `referrals` | دوال الإحالة |
| `room_chat_mutes` · `room_moderation_audit` · `room_presence` | دوال الغرفة (`room_owner_moderation_action`، `record_wattar_room_presence`) |
| `stories` | `list_active_stories` / `create_my_story` / `delete_my_story` |
| `support_tickets` · `support_ticket_messages` | دوال الدعم (`create_support_ticket`, `list_support_queue`, ...) |
| `user_follows` | `follow_wattar_user` / `unfollow_wattar_user` |
| `user_posts` | `create_my_post` / `list_wattar_profile_posts` / `delete_my_post` |
| `user_sessions` | `record_my_session_started` / `revoke_inactive_user_sessions` |

**قاعدة يجب تثبيتها في M2:** أي جدول بلا policy ولا دالة تعريفية = خطأ. أما بلا policy **مع** دالة تعريفية = نمط مقصود. سنوثّق هذا في مصفوفة RLS (M2.1).

### ٣.٢ جداول حساسة معها policies — تحتاج فحصاً لا ادعاءً
`rooms` (٦) · `room_messages` (٤) · `room_seats` (٣) · `gifts` (٥) · `deposits` (٣) · `wallet_transactions` (١) · `withdrawals` (٢) · `transfers` (٢) · `verified_hosts` (٢) · `users` (٢).

**إيجابي:** `wallet_transactions` عليها `trg_wallet_no_update` و`trg_wallet_no_delete` → دفتر مالي غير قابل للتعديل أو الحذف. هذا يطابق §12 من الملف.

---

## 4) الدوال المنشورة (١٢٣)

- **١١٥ `SECURITY DEFINER`**: كل منطق التطبيق الحسّاس (المحفظة، الغرف، المجتمع، الإدارة، الوكالات، الدعم).
- **٨ `INVOKER` تطبيقية**: `record_wallet_transaction`, `increment_user_stat`, `get_user_daily_totals`, `update_user_deposit_stats`, `generate_referral_code`, `set_referral_code`, `prevent_wallet_modification`, `update_updated_at`.
- **ملاحظة أمنية:** `prevent_wallet_modification` موجودة كـ`INVOKER` — يجب التأكد في M2 أنها **trigger** يمنع تحديث أرصدة `users` مباشرة، لا دالة عادية.

**نقطة تحتاج فحصاً في M2:** وجود `record_wallet_transaction` كـ`INVOKER` يعني أنها تعتمد على سياق المستدعي. سأتأكد أنها لا تُستدعى من العميل مباشرة (يجب أن تُستدعى فقط من دوال `DEFINER`).

---

## 5) التخزين وRealtime والامتدادات

### ٥.١ Storage — ٦ buckets
| Bucket | عام؟ | في الكود؟ |
|---|---|---|
| `avatars` | نعم | نعم |
| `deposit-proofs` | لا | نعم |
| `wattar-posts` | لا | نعم |
| `wattar-stories` | لا | نعم |
| `gift-icons` | نعم | لا (يُدار من الدوال/اللوحة) |
| `withdrawal-proofs` | لا | لا (يُدار من الدوال/اللوحة) |

**إيجابي:** سياسات Storage موجودة لـ`avatars` و`deposit-proofs` و`wattar-posts` و`wattar-stories` و`withdrawal-proofs`، ومبنية على `auth.uid()` ومسارات مقيّدة. يحتاج فحصاً نهائياً في M2/M9 (حد الحجم، ونوع المحتوى).

### ٥.٢ Realtime — ٩ جداول
`friend_requests` · `game_challenge_players` · `game_challenges` · `private_messages` · `room_invitations` · `room_messages` · `room_seats` · `rooms` · `user_notifications`.

**ملاحظة:** `game_challenges` و`game_challenge_players` منشورتان على Realtime رغم أن **تحديات PK مؤجلة** (§28). يجب إزالتهما مع إزالة النظام.

### ٥.٣ الامتدادات
`btree_gist` · `pg_stat_statements` · `pg_trgm` · `pgcrypto` · `plpgsql` · `supabase_vault` · `uuid-ossp`. لا شيء غريب أو مكلف.

---

## 6) أخطر اكتشاف: المحادثة الخاصة معطّلة فعلياً

هذا ليس استنتاجاً نظرياً؛ هو تعارض مباشر بين ما يناديه الكود وما هو منشور:

| الدالة التي يناديها الكود | الحالة الفعلية | الملف | الأثر |
|---|---|---|---|
| `get_private_message_quote` | **غير موجودة** | `wattar-app/app/messages/[id].tsx:88` | `loadMessages` يرمي الخطأ فوراً → **الشاشة لا تُحمّل** |
| `send_private_message` بـ٤ وسائط | المنشور **٢ وسائط** فقط (`p_conversation_id, p_body`) | `wattar-app/app/messages/[id].tsx:210` | إرسال الرسالة يفشل |
| `send_host_intro_batch` | غير موجودة | `wattar-app/app/_layout.tsx:132` | يفشل بصمت |
| `is_wattar_host_program_member` | غير موجودة | `wattar-app/app/user/[id].tsx:108` | ملف المستخدم يفشل جزئياً |
| `get_my_host_outreach_preference` / `set_my_host_outreach_preference` | غير موجودتين | `wattar-app/app/(tabs)/settings.tsx` | إعدادات المضيفة لا تعمل |
| ٧ دوال `admin_*` | غير موجودة | `wattar-admin/src/pages/MessagingPage.tsx` | صفحة المراسلة في اللوحة معطّلة |

**الإجمالي: ١٢ دالة مفقودة + تعارض توقيع واحد.**

**السبب الجذري:** `patch_paid_messaging.sql` لم يُطبّق، بينما كُتبت الواجهة على أساسه.
**الحلّان الممكنان (لا أنفّذ أحدهما بلا قرارك):**
1. **تطبيق `patch_paid_messaging.sql`** بعد نسخة احتياطية — يعيد المحادثة للعمل ويطابق §20 (رسائل مدفوعة بحد مجاني). **توصيتي.**
2. التراجع بالواجهة إلى الدوال القديمة (٢ وسائط) — يعيد المحادثة لكن يلغي التسعير المدفوع المطلوب في §20.

---

## 7) الفروق مقابل `المطلوب تماما .txt` (تحتاج قراراً)

| # | الفرق | ما يقوله الملف | الواقع | المرحلة |
|---|---|---|---|---|
| 1 | **العملات** | عملتان: Coin وDiamond (§11) | ٥ أرصدة: `balance_gold`, `balance_diamond`, `balance_diamond_promo`, `balance_converted_coins`, `game_points` | M3 |
| 2 | **PK مؤجّل** | لا تحديات PK (§28) | جدولان + ٥ دوال + policies + Realtime + لوحة | M2 |
| 3 | **التحويلات** | Coin لا يتحول إلى Diamond (§11) | جدول `transfers` وسياساته قائمة، بينما دالة `transfer` معطّلة (`410`) | M3 |
| 4 | **قصص الفيديو** | صور فقط، لا فيديو (§8) | `create_my_story` يقبل `p_media_type` (image/video) وbucket `wattar-stories` | M9 |
| 5 | **بيانات الألعاب** | نتائج على الخادم فقط (§19) | `game_rounds` و`game_configs` عليها `SELECT` للعامة بـ`true` | M2/M9 |
| 6 | **الرسائل المدفوعة** | حد مجاني ثم مدفوع (§20) | `patch_paid_messaging` غير مطبّق → المحادثة معطّلة | M9 |
| 7 | **المنشورات** | معرض صور لا منشورات/إعجابات (§8) | النظام معروض كمعرض صور فعلاً، لكن التسمية `user_posts`/`posts` | M9 (تسمية فقط) |
| 8 | **الأجهزة والجلسات** | إدارة أجهزة وجلسات (§7) | `user_sessions` موجود، `user_devices` غير موجود (في مجلد مهمَل فقط) | M1 |

---

## 8) ما هو «مطبّق» بالمعنى الدقيق

وجود الجدول يثبت أن `CREATE TABLE` نُفّذ، **لا** أن كل policies/دوال/grants في الملف نُفّذت بنسختها الأخيرة. لذلك أصنّف ملفات الـ٣٥ patch:

| التصنيف | الملفات |
|---|---|
| **مؤكد التطبيق (كائنات أساسية موجودة)** | كل الملفات التي تُنشئ جداولاً، عدا `patch_paid_messaging.sql` |
| **مؤكد عدم التطبيق** | `patch_paid_messaging.sql` |
| **غير قابل للتحقق من Probe (نوع/enum/grant)** | `patch_financial_rls.sql` · `patch_membership_wallet_type.sql` · `patch_paid_messaging_wallet_types.sql` · `patch_slots_enum.sql` · `patch_admin_rls.sql` · `patch_profile_editing.sql` |

**التالي:** نسخة `pg_dump` بعد نسخة احتياطية تحسم الباقي. لا يمكن بناء baseline صادق من أسماء الجداول وحدها.

---

## 9) المطلوب منك الآن

| # | القرار | لماذا الآن |
|---|---|---|
| 1 | **نسخة احتياطية + `pg_dump`** | بدونها لا baseline ولا migrations آمنة. |
| 2 | **تطبيق `patch_paid_messaging.sql`؟** | المحادثة الخاصة معطّلة الآن. أنصح بتطبيقه بعد النسخة الاحتياطية. |
| 3 | **mapping العملات الخمس** | يحدد شكل M3 كاملاً. |
| 4 | **`game_challenges` = PK المؤجّلة؟** | إن نعم، أحذفها بدفعة M2. |
| 5 | **`transfers`** | يُحذف أم يُبقى معطّلاً؟ |
| 6 | **هل تسجيل الإيميل/الباسورد مفعّل؟** | بدون SMTP لا تحقق بريدي. |
