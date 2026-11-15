# سجل الـMigrations — مالك الحقيقة لقاعدة البيانات
**التاريخ:** 2026-11-14 · **الحالة:** تسجيل فقط. **لم يُنشأ ولا يُطبّق أي migration بعد.**

> القاعدة الذهبية: **لا migration بلا نسخة احتياطية، ولا migration بلا رقم، ولا تعديل على migration مُطبّق.**
> حتى تصل نسخة `pg_dump`، هذا الملف يسجّل ما نعرفه فقط. لا نكتب SQL «من الذاكرة».

---

## 1) الوضع الحالي

| البند | الحالة |
|---|---|
| مجلد `supabase/migrations/` | موجود (توثيق فقط، بلا ملفات SQL) |
| Baseline | **معلّق** — ينتظر نسخة احتياطية + `pg_dump` |
| ترتيب الـ٣٥ patch | غير موثّق تاريخياً، لكن **الكائنات الناتجة موجودة** |
| الملف الوحيد غير المطبّق | `patch_paid_messaging.sql` + `patch_paid_messaging_followers.sql` (الثاني يعتمد على الأول) |

**لماذا لا نكتب baseline يدوياً؟** لأن أسماء الجداول وحدها لا تعطينا الأعمدة والقيود والفهارس والـgrants والـpolicies بنسختها النهائية. أي baseline يدوي سيكون **كذباً هندسياً** يكسر أول إعادة بناء.

---

## 2) خطة الـBaseline

1. المدير ينشئ نسخة احتياطية من Supabase (Database → Backups، أو `pg_dump`).
2. نستخرج الـschema الفعلي:
   ```bash
   # من جهاز يملك اتصال القاعدة (لا تُحفظ الكلمة في المستودع)
   supabase db dump --schema public -f supabase/migrations/00000000000000_baseline.sql
   ```
   أو:
   ```bash
   pg_dump --schema-only --schema=public "$DATABASE_URL" > supabase/migrations/00000000000000_baseline.sql
   ```
3. نراجع الـbaseline (جداول/دوال/policies/triggers) ونقارنه بـ`SCHEMA_RECONCILIATION_2026-11.md`.
4. نثبّت الـbaseline كـcommit أول قبل أي تغيير.
5. بعدها فقط تبدأ migrations الترقية من `00000000000001`.

**بديل مؤقت مقبول:** إن تعذّر `pg_dump`، تُجمّع الـ٣٥ patch بالترتيب المنطقي في `00000000000000_baseline_from_patches.sql` **بعد** التحقق أنها تعطي نفس الكائنات الموجودة (dry-run على مشروع اختبار). لا يُعتمد بلا هذا التحقق.

---

## 3) الـ٣٥ patch — الحالة والترقيم المقترح

الترقيم التالي **مقترح** للترتيب المنطقي المستخرج من شروط الملفات، وليس تأكيداً تاريخياً. لن تُنشأ الملفات إلا في M2+/بعد الـbaseline.

| # | الملف | الحالة الفعلية | Migration مقترح |
|---|---|---|---|
| 1 | `patch_auth_profile_trigger.sql` | **مؤكد** (`handle_new_auth_user` موجود) | `...0001` |
| 2 | `patch_social_foundation.sql` | **مؤكد** (٩ جداول + ٢٥ دالة) | `...0002` |
| 3 | `patch_wattar_v2_social.sql` | **مؤكد** (١٠ جداول) | `...0003` |
| 4 | `patch_user_onboarding_privacy.sql` | **مؤكد** (دوال onboarding/privacy) | `...0004` |
| 5 | `patch_social_profiles_posts.sql` | **مؤكد** (`user_posts` + دوال) | `...0005` |
| 6 | `patch_wattar_v2_wallet.sql` | **مؤكد** (`deposit_methods` + ودائع) | `...0006` |
| 7 | `patch_wattar_v2_wallet_economy.sql` | **مؤكد** (٣ جداول + ١٢ دالة) | `...0007` |
| 8 | `patch_three_currency_economy.sql` | **مؤكد** (`get_my_wallet_options`) | `...0008` |
| 9 | `patch_paid_messaging_wallet_types.sql` | **✅ مطبّق** 2026-11-14 (`Success. No rows returned`) | `...0009` |
| 10 | `patch_membership_wallet_type.sql` | **غير مُتحقَّق** (قيمة enum) | `...0010` |
| 11 | `patch_store_missions.sql` | **مؤكد** (جدولان + ٤ دوال) | `...0011` |
| 12 | `patch_paid_messaging.sql` | **✅ مطبّق** 2026-11-14 عبر `supabase db query --remote` (بعد فشل اللصق في محرر SQL) | `...0012` |
| 13 | `patch_memberships_xp_acceleration.sql` | **مؤكد** (جدولان) | `...0013` |
| 14 | `patch_host_program.sql` | **مؤكد** (`host_applications`, `verified_hosts`) | `...0014` |
| 15 | `patch_notification_inbox.sql` | **مؤكد** (`user_notifications` + trigger) | `...0015` |
| 16 | `patch_platform_activity_log.sql` | **مؤكد** (`platform_activity_log`) | `...0016` |
| 17 | `patch_room_access.sql` | **مؤكد** (policies الغرف) | `...0017` |
| 18 | `patch_room_realtime.sql` | **مؤكد** (publication) | `...0018` |
| 19 | `patch_room_presence.sql` | **مؤكد** (`room_presence`) | `...0019` |
| 20 | `patch_room_owner_moderation.sql` | **مؤكد** (`room_chat_mutes`, `room_moderation_audit`) | `...0020` |
| 21 | `patch_support_role.sql` | **غير مُتحقَّق** (قيمة enum) | `...0021` |
| 22 | `patch_support_tickets.sql` | **مؤكد** (جدولان + ٧ دوال) | `...0022` |
| 23 | `patch_admin_audit_controls.sql` | **مؤكد** (`is_admin`, `admin_set_user_status`) | `...0023` |
| 24 | `patch_admin_rls.sql` | **مؤكد** (policies الأدمن) | `...0024` |
| 25 | `patch_admin_account_controls.sql` | **مؤكد** (٢ دوال) | `...0025` |
| 26 | `patch_admin_agent_controls.sql` | **مؤكد** (`admin_set_agent_status`) | `...0026` |
| 27 | `patch_admin_host_management.sql` | **مؤكد** (`admin_manage_verified_host`) | `...0027` |
| 28 | `patch_agent_dashboard_access.sql` | **مؤكد** (٦ دوال) | `...0028` |
| 29 | `patch_agent_permissions.sql` | **مؤكد** (`wattar_current_agent_id`, ...) | `...0029` |
| 30 | `patch_host_pending_accounts.sql` | **غير مُتحقَّق** (عمود/حالة) | `...0030` |
| 31 | `patch_profile_editing.sql` | **مؤكد** (`update_my_profile`) | `...0031` |
| 32 | `patch_public_auth_rate_limits.sql` | **مؤكد** (`public_auth_rate_limits`) | `...0032` |
| 33 | `patch_financial_rls.sql` | **غير مُتحقَّق** (REVOKE فقط، لا يُقرأ من Probe) | `...0033` |
| 34 | `patch_slots_enum.sql` | **غير مُتحقَّق** (قيمة enum) | `...0034` |
| 35 | `patch_slots_game_config.sql` | **مؤكد** (`game_configs`) | `...0035` |
| 36 | `patch_paid_messaging_followers.sql` | **✅ مطبّق** 2026-11-14 عبر `supabase db query --remote` (متابعون متبادلون مجاناً) | `...0036` |
| 37 | `patch_session_management.sql` | **✅ مطبّق** 2026-11-14 عبر `supabase db query --remote` (M1.5 الأجهزة والجلسات) | `...0037` |
| 38 | `patch_privacy_settings.sql` | **✅ مطبّق** 2026-11-15 عبر `supabase db query --remote` (M1.6 الخصوصية الست) | `...0038` |
| 39 | `patch_block_enhancements.sql` | **✅ مطبّق** 2026-11-15 (M1.6+M1.7: الحظر والخصوصية في القصص والغرف والمراسلة) | `...0039` |
| 40 | `patch_privacy_view_info.sql` | **✅ مطبّق** 2026-11-15 (بوّابة `view_info` داخل `wattar_can_view_profile` + `get_wattar_progress`) | `...0040` |
| 41 | `patch_privacy_service_role_grant.sql` | **✅ مطبّق** 2026-11-15 (GRANT تنفيذ `check_privacy_permission` لـ`service_role`) | `...0041` |
| 42 | `patch_block_cleanup.sql` | **✅ مطبّق** 2026-11-15 (الحظر يلغي الصداقة المقبولة ويحذف المتابعة بالاتجاهين) | `...0042` |
| 43 | `patch_fix_audit_trigger_room_seats.sql` | **✅ مطبّق** 2026-11-15 (**إصلاح عطل إنتاجي**: `OLD.user_id` على `friend_requests`) | `...0043` |
| 44 | `patch_fix_event_notification_trigger.sql` | **✅ مطبّق** 2026-11-15 (**إصلاح عطل إنتاجي**: `NEW.status`/`OLD.status` قبل التحقق من الجدول) | `...0044` |
| 45 | `patch_adult_consent_log.sql` | **✅ مطبّق** 2026-11-15 (M1.4: جدول `user_consents` append-only + تريغران لتسجيل موافقة ١٨+ + تعبئة رجعية ٨ صفوف) | `...0045` |

**استثناء مرسّخ:** المدير قرر 2026-11-14 أن **الحسابات كلها تجريبية**، فلا نسخة احتياطية مطلوبة قبل migration #37 (إضافات فقط: عمود + ٣ دوال، بلا حذف ولا تعديل بيانات).

**عدد «غير مُتحقَّق»:** ٦. تُحسم كلها بنسخة `pg_dump` (enums + grants).

---

## 3.5) سجل نشر الدوال السحابية (Edge Functions)

| # | الدالة | النسخة | التاريخ | التغيير | التحقق |
|---|---|---|---|---|---|
| F01 | `livekit-token` | 7 → **8** | 2026-11-15T10:42:16Z | فحص الحظر + `check_privacy_permission(...,'enter_rooms')` قبل إصدار توكن الصوت | الملف المنزَّل من الإنتاج مطابق SHA256 للملف المحلي (٦٨١١ بايت) · استدعاء بمفتاح anon رجّع `401 INVALID_TOKEN` أي أن الدالة **أقلعت** ولم ترجع `BOOT_ERROR` |

**القاعدة:** كل نشر دالة يُسجَّل هنا بتاريخه ونسخته وطريقة التحقق. لا نشر بلا سطر هنا.

---

## 4) قواعد إلزامية من الآن

1. كل تغيير قاعدة = ملف migration واحد مرقّم، لا SQL متفرق في المحادثة.
2. كل migration: `BEGIN; ... COMMIT;` عند الإمكان، أو ملف ذرّي.
3. قبل التطبيق: نسخة احتياطية + مراجعة بشرية + موافقة المدير.
4. بعد التطبيق: سطر في `DEVELOPMENT_ROADMAP.md` (التاريخ، الملف، النتيجة، طريقة التراجع).
5. لا تعديل على migration مُطبّق؛ التصحيح بـmigration جديد.
6. لا حذف بيانات مالية/تاريخية؛ التصحيح بقيود عكسية (§12).
7. أسرار الاتصال لا تُكتب في أي ملف ولا في المحادثة.

---

## 5) التراجع (Rollback)

كل migration يجب أن يحدّد مسبقاً:
- ما الذي يفعله.
- كيف يُلغى (migration عكسي أو استعادة نسخة).
- هل هو آمن للإعادة (`IF NOT EXISTS` / `ON CONFLICT`).

بدون هذه الثلاثة لا يُعتمد.
