# سجل الـMigrations — مالك الحقيقة لقاعدة البيانات
**التاريخ:** 2026-11-16 · **الحالة:** ٤٩ ترقية مطبّقة (9–49 عبر `supabase db query --remote`) + نشر ٢٠ نسخة دالة سحابية.

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
| 46 | `patch_harden_table_grants.sql` | **✅ مطبّق** 2026-11-15 (M2.2: سحب صلاحيات `anon` كاملة من `public`، سحب `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` من `authenticated`، منع الكتابة المباشرة على ١٨ جدولاً مالياً/هوية، توحيد `search_path` لثلاث دوال) | `...0046` |
| 47 | `patch_room_rpc.sql` | **✅ مطبّق** 2026-11-15 (M2.3: أربع دوال RPC حصرية — `claim_room_seat`, `leave_room_seat`, `set_room_mic`, `send_room_message` — + قيد تفرّد `room_seats(room_id,user_id)` + إلغاء ٤ سياسات كتابة مباشرة + سحب `INSERT/UPDATE/DELETE` من `room_messages` و`room_seats` لـ`authenticated` و`anon`) | `...0047` |
| 48 | `patch_rate_limiting_risk.sql` | **✅ مطبّق** 2026-11-16 (M2.4: حد طلبات قاعدي + تقييم مخاطر — ٤ جداول `rate_limit_buckets`/`device_fingerprints`/`ip_reputation`/`risk_events` بلا أي وصول عميل + دوال `check_rate_limit` و`record_risk_event` و`register_device_fingerprint` و`get_risk_score` و٥ دوال مختصرة؛ سحب تنفيذ دوال المخاطر من `anon`/`authenticated` رغم DEFAULT PRIVILEGES) | `...0048` |
| 49 | `patch_wire_rate_limit_rpc.sql` | **✅ مطبّق** 2026-11-16 (M2.4: ربط `check_room_rate_limit` بدوال الغرف — `claim_room_seat` 10/دقيقة، `set_room_mic` 20/دقيقة، `send_room_message` 30/دقيقة تكميلي) | `...0049` |
| 50 | `patch_moderation_core.sql` | **✅ مطبّق** 2026-11-16 (M2.5/القسم 22: نظام الإشراف — ٦ جداول `moderation_settings`/`moderation_words`/`user_violations`/`user_penalties`/`moderation_exceptions`/`moderation_appeals` بـRLS + توسيع `user_reports` بحالة المراجعة + توسيع قيد `user_notifications_event_type_check` بنوعي `moderation_penalty`/`moderation_appeal` + دوال التطبيع والفلترة `normalize_arabic_text`/`moderation_compact_text`/`check_word_filter` (مقاومة التحايل بالتشكيل/التطويل/التكرار/الleet/فصل الحروف) + `is_account_active` (استعادة تلقائية للحظر المؤقت المنتهي) + `has_active_chat_mute` + `record_word_violation` (تصعيد تلقائي كتم→حظر مؤقت→دائم + `record_risk_event('blocked_action')`) + ٩ دوال إدارية service_role فقط + `submit_moderation_appeal`/`get_my_moderation_status` للمصادقين + ربط الفلترة في `send_room_message` و`send_private_message` — **إرجاع `blocked:true` بدل RAISE حتى تُلتزم المخالفة** (تفاعل R30) + كل الدوال الخدمية بقاعدة P8) | `...0050` |
| 51 | `patch_audit_log_reason.sql` | **✅ مطبّق** 2026-11-16 (M2.6/القسم 24: عمود `reason` في `admin_audit_log` + تعبئة رجعية من `metadata` التاريخية + زناد `audit_reason_extract` BEFORE INSERT يستخرج السبب تلقائياً من metadata — يغطي دوال RPC الإدارية الـ17 دون تعديل أجسامها + إلحاق فقط: زناد `admin_audit_log_append_only` يرفض UPDATE/DELETE وزناد `admin_audit_log_no_truncate` يرفض TRUNCATE (طوارئ المالك الموثقة: DISABLE TRIGGER) + REVOKE UPDATE/DELETE/TRUNCATE من anon/authenticated/service_role + `audit_admin_row_change` v2 يلتقط سبب التعديلات المباشرة من ترويسات الطلب + `p_reason text DEFAULT NULL` لـ6 دوال بلا سبب: `admin_upsert_moderation_word`/`admin_delete_moderation_word`/`admin_update_moderation_settings`/`admin_update_private_message_settings`/`admin_set_host_intro_template`/`admin_upsert_membership_plan` بإعادة إنشاء DROP+CREATE نظيفة بلا تعدد تحميلات مع grants مطابقة) | `...0051` |
| 51f | `patch_audit_log_reason_fix.sql` | **✅ مطبّق** 2026-11-16 بعد #51 بدقائق (تصحيح وقت التشغيل: أسماء GUC المخصصة لا تقبل الشرطة `request.headers.x-audit-reason` — القراءة الصحيحة كائن JSON واحد `current_setting('request.headers', true)::jsonb ->> 'x-audit-reason'` مع حماية استثناء. طُبّع قبل أي استخدام فعلي، والملف الأصلي #51 حُدّث ليتطابق) | ضمن #51 |
| 55 | `patch_gift_commissions.sql` | **✅ مطبّق** 2026-11-16 (M3.4/القسم 11 — قرار D3: عمولات الهدية + القيد المزدوج — `revenue_accounts` + `revenue_ledger` append-only، نسب افتراضية في `admin_settings` (صفر)، تخصيص لكل مضيفة في `verified_hosts`، لكل وكيل في `agents`، تُحسب من أجر المضيفة لا من المرسل، `reconcile_gift_economy()` تتحقق صفر القيمة لكل هدية، اختبار 3 سيناريوهات نجح والمطابقات نظيفة) | `...0055` |
| 61 | `patch_usdt_flows_m4.sql` | **✅ مطبّق** 2026-11-17 (M4/القسم 13: دورة الشحن والسحب USDT كاملة — إعادة كتابة الدوال الأربع بنفس تواقيعها فلا تتغير المتصلات: `create_deposit_request` يتحقق من الشبكة (trc20/bep20 فقط) وصيغة العنوان/الهاش حسب الشبكة ويمنع تقديم نفس تحويل USDT مرتين (قفل advisory + فهرس فريد جزئي على `usdt_tx_hash` + فهرس فريد على (method, lower(external_ref))) + رسوم شحن قابلة للإدارة (`deposit_fee_percent` افتراضي 0 — رسوم الشبكة على المرسل بقرار D7)؛ `settle_deposit_request`/`settle_diamond_withdrawal` آلة حالات كاملة بأفعال review/request_info/reject/approve/processing/fail مع **سبب إلزامي** عند الرفض/الفشل ورد الـDiamond بقيود عكسية وتدقيق في admin_audit_log لكل قرار؛ `create_my_diamond_withdrawal`: أهلية المضيفة الموثقة النشطة (D8) + طرق USDT/الوكيل فقط (أُلغيت شام كاش/سيرياتل كاش من السحب وفق القسم 13) + تحقق صيغة عنوان TRC20/BEP20 + **سقف يومي بالدولار** `max_withdrawal_usd_per_day` (كان موجودًا بلا إنفاذ)؛ إضافة `processing` إلى enum `tx_status` (الحالة السابعة لآلة الحالات)؛ أفعال التدقيق الجديدة في `audit_action_type`؛ فهرس فريد على مرجع دفع السحب الخارجي؛ **تجميد جدول `withdrawals` القديم بزناد** (سحب Coin ممنوع نهائيًا بقرار D1 — الجدول فارغ ويُبقى للأرشفة)؛ حذف `min_withdrawal_gold` المهمل؛ P8 على كل الدوال المالية. **اختبارات 25/25 داخل rollback** (شحن صالح/مكرر الهاش/شبكة وعنوان غير صالحين/idempotency/مراجعة/رفض بلا سبب مرفوض/اعتماد يضيف الرصيد/اعتماد مزدوج آمن؛ سحب صالح بشبكات وعناوين سيئة مرفوضة/طرق غير مدعومة/غير مضيفة مرفوض/سقف يومي/معالجة/فشل يرد كاملًا/رفض يرد/اعتماد يستلزم إثباتًا ودورة كاملة $9.50 صافي؛ تجميد سحب Coin؛ مطابقة الدفتر ok) | `...0061` |
| 61f2 | `patch_usdt_flows_m4_fix2.sql` | **✅ مطبّق** 2026-11-17 بعد #61 مباشرة (كشفه الاختبار: عمود `action` في `admin_audit_log` من نوع `audit_action_type` فكانت الدالتان تمرران النص بلا cast — أُضيفت القيم review/request_info/processing/fail إلى الـenum في `patch_usdt_flows_m4_prep2.sql` ثم أعيد تطبيق دالتي التسوية بالـcast) | ضمن #61 |
| 61f | `patch_usdt_flows_m4_fix.sql` | **✅ مطبّق** 2026-11-17 بعد #61 بدقائق (كشفه الاختبار: فحص تكرار `tx_hash` كان يجري قبل فحص idempotivity فكانت الإعادة الآمنة لنفس طلب الشحن تُرفض كتكرار تحويل — نُقل الفحص إلى ما بعد إعادة الصف الidempotent) | ضمن #61 |
| 61-prep2 | `patch_usdt_flows_m4_prep2.sql` | **✅ مطبّق** 2026-11-17 (إضافة أفعال سجل التدقيق review/request_info/processing/fail إلى enum `audit_action_type` — منفصلة لأن قيمة enum جديدة لا تُستخدم في نفس المعاملة) | ضمن #61 |
| 61-prep | `patch_usdt_flows_m4_prep.sql` | **✅ مطبّق** 2026-11-17 (إضافة حالة `processing` إلى enum `tx_status` لإكمال آلة حالات M4.2 السبع — منفصلة لنفس السبب) | ضمن #61 |
| 60 | `patch_rate_consistency_3000.sql` | **✅ مطبّق** 2026-11-17 (M3.7/القسمان 11-12: توحيد كل النِسب على أساس 1 USD = 3000 Coin — `gold_to_usdt_rate` = 0.00033333 و`diamonds_per_usd` = 3000 (Diamond = Coin بالقيمة، فتبقى حصة المضيفة 50% عند ratio 50) و`min_withdrawal_diamonds` = 30000 (تبقى 10$). **سبب إلزامي:** بقي `gold_to_usdt_rate` على 0.0009 فكانت المحاسبة تحسب على المرسل 3× ما يدفعه فعلاً، و`settle_gift_send` يسجّل هامش منصة متضخم، وأي سحب لاحق كان سيدفع أكثر مما قُبض. القيود التاريخية محفوظة بـ`rates_snapshot` خاصتها؛ مطابقتا `reconcile_gift_economy` و`reconcile_wallet_ledger` ok؛ اختبار هدية كامل بعد التغيير: 100 Coin ($0.0333) → 50 Diamond للمضيفة ($0.0167) + هامش $0.0167، ثم rollback) | `...0060` |
| 59h | `patch_daily_bonus_amount.sql` | **✅ مطبّق** 2026-11-17 (M3.7: `daily_bonus_gold` 500 → 50 (القيمة القديمة كانت بالنقاط؛ الدالة الجديدة تسقفها عند 100)؛ `usdt_to_gold_rate` 1000 → 3000 توحيداً مع `paid_coins_per_usd` — مفتاح غير مستخدم في أي دالة/عميل، أُوحّد منعاً للالتباس في M4) | `...0059h` |
| 59g | `patch_missions_coin_fix2.sql` | **✅ مطبّق** 2026-11-17 بعد #59f (إصلاح خلل قديم: `award_user_xp` مقفلة على service_role بينما `claim_daily_mission` تُستدعى من العميل، فكان استلام أي مهمة مكتملة يفشل عند منح XP — منطق XP نُقل إلى `award_user_xp_internal` بلا فحص دور وغير ممنوحة لأي دور عميل، و`award_user_xp` تظل service_role وتفوّض لها، و`claim_daily_mission` تستدعي الداخلية بعد التحقق من `auth.uid()`) | ضمن #59 |
| 59f | `patch_missions_coin_fix.sql` | **✅ مطبّق** 2026-11-17 بعد #59 بدقائق (تصحيح كشفه الاختبار: `entry_kind` المسموح normal/reversal/adjustment/opening فقط — لا يوجد 'grant'؛ منح المكافآت اليومية قيود 'normal') | ضمن #59 |
| 59 | `patch_missions_coin.sql` | **✅ مطبّق** 2026-11-17 (M3.7: المهام والمكافأة اليومية تعطيان Coin — `daily_mission_claims.coin_awarded`؛ `claim_daily_game_points_for_user` أُعيدت كتابتها لتمنح `gold` عبر `record_wallet_transaction` (سقف 100، منع تكرار بمفتاح يومي في المحفظة)؛ `claim_daily_mission` تتحقق من التقدم ثم تمنح Coin وXP؛ `list_daily_missions` تُرجع `reward_gold`/`coin_awarded`؛ `daily_mission_progress('daily_grant')` تقرأ من `wallet_transactions` بدل دفتر النقاط المجمّد؛ إلغاء `claim_daily_task_coin` من #56 (كانت تدفع بلا تحقق تقدم)؛ اختبارات مستخدم حقيقي داخل rollback: مكافأة يومية، تكرارها مرفوض، مهمة +100 بعد اكتمال تقدمها، تكرارها already_claimed، مهمة غير مكتملة مرفوضة) | `...0059` |
| 58 | `patch_opening_balances.sql` | **✅ مطبّق** 2026-11-16 (M3/القسم 12: قيود افتتاحية موثّقة — كشفت مطابقة #57 أن أرصدة مستخدمين لا يقابلها قيود (خلل `RETURNING game_points` في #56 يعيد القيمة بعد التصفير = صفر، فحُوّلت النقاط بلا قيود + أرصدة زُرعت قبل الدفتر). لكل (مستخدم/عملة) بفرق، قيد واحد `entry_kind='opening'` يوثّق الفرق بلا أي تغيير رصيد؛ بعدها `reconcile_wallet_ledger` ok: 37 قيداً، صفر فروق، صفر سالب) | `...0058` |
| 57 | `patch_game_bets_in_coin.sql` | **✅ مطبّق** 2026-11-16 (M3.7: تسوية الألعاب الخمس بالـCoin — `play_game_with_points` أُعيدت بنفس توقيعها فلا تتغير دوال الحافة، لكن الرهان/الدفع يمرّان عبر `record_wallet_transaction` بعملة gold مع `pair_id` و`rates_snapshot` وأسباب game_bet/game_win؛ سجل الجولات في `game_rounds`/`game_bets` كما هو؛ حذف النسخة التجريبية `play_game_with_coin` من #56؛ زناد `trg_freeze_game_points_ledger` يمنع أي كتابة جديدة على دفتر النقاط؛ اختبارات داخل rollback: رهان خاسر 100 → -100، رابح 100/×2.5 → +250، إعادة نفس المفتاح بلا خصم، رصيد غير كافٍ مرفوض، مطابقة نظيفة) | `...0057` |
| 56 | `patch_game_economy_bigo.sql` | **✅ مطبّق** 2026-11-16 (M3.7/القسم 11 — قرار D1: اقتصاد الألعاب على نمط بيغو لايف — `paid_coins_per_usd` = 3000؛ تحويل `game_points` الموجود إلى `balance_gold` مع قيد تدقيق؛ دوال جديدة `play_game_with_coin`/`claim_daily_bonus_coin`/`claim_daily_task_coin` تراهن وتعطي `gold` مباشرة؛ `daily_missions.reward_gold` مع سقف 100؛ الدوال القديمة `play_game_with_points`/`claim_daily_game_points*`/`claim_daily_mission` موثّقة كمجمّدة؛ `users.game_points` مجمَّد للتدقيق فقط؛ اختبارات: مكافأة يومية 100 Coin + مهمة 100 Coin + رهان 50 Coin + مطابقة نظيفة) | `...0056` |
| 55f | `patch_gift_commissions_fix.sql` | **✅ مطبّق** 2026-11-16 بعد #55 بدقائق (تصحيح كشفه اختبارات العمولات: المضيفة تستلم الصافي `host_net` لا `gross`، وحساب `credited_usd` لكل المخرجات `gross * diamond_usdt` حتى يتوازن القيد بالقيمة؛ الملف الأصلي #55 حُدّث ليتطابق، الاختبارات أُعيدت والمطابقات نظيفة) | ضمن #55 |
| 54 | `patch_gift_earnings_host_only.sql` | **✅ مطبّق** 2026-11-16 (M3.1/القسم 11 — قرار D2: أجر الهدية — المستلم العادي يأخذ `gold` في رصيده العادي، و`diamond` حصراً لـ`verified_hosts.status='active'`؛ توسيع قيد `gift_transactions_received_currency_check` ليشمل `gold`؛ إعادة إنشاء `settle_gift_send` مع لقطة نسب (نوع المستلم/نسبة/سعر)، `pair_id` لاقتران الطرفين، وأسباب تدقيقية؛ الاختبار: مسار موثقة → Diamond +50، مسار عادي → Coin +50، لا تغيّر في الطرف الآخر، مطابقة نظيفة. القيم المالية للهدايا القائمة لم تُمس) | `...0054` |
| 52 | `patch_push_token_handover.sql` | **✅ مطبّق** 2026-11-16 (M2.8/F2: `register_my_push_token` ينقل ملكية رمز الدفع إلى الحساب الحالي بدل رفضه عند وجوده لحساب آخر — كان رمز الجهاز يبقى معلّقاً بعد إعادة التثبيت أو خروج غير مكتمل فيمنع الحساب الجديد من استلام الإشعارات. الصلاحية للمستخدم المُصادَق فقط، `anon` ممنوع) | `...0052` |
| 53 | `patch_ledger_v2.sql` | **✅ مطبّق** 2026-11-16 (M3/القسمان 11-12: ترقية دفتر المحفظة — أعمدة `operation_no` رقم عملية مقروء فريد، `ledger_seq` تسلسل تصاعدي، `entry_kind` (normal/reversal/adjustment/opening)، `reversal_of` بقيد فريد، `reason`، `executed_by`/`executed_by_role`، `rates_snapshot`، `pair_id`؛ تعبئة رجعية للقيود الخمسة بلا تغيير أي مبلغ؛ إعادة إنشاء `record_wallet_transaction` بنفس الحساب مع 7 معاملات اختيارية؛ `reverse_wallet_transaction` (سبب إلزامي + منع العكس المزدوج + منع السالب + تسجيل في `admin_audit_log`)؛ `reconcile_wallet_ledger` (فروق الأرصدة + انقطاع السلسلة + السالب + سلامة العكوس)؛ كل الدوال الخدمية بقاعدة P8) | `...0053` |
| 53f | `patch_ledger_v2_fix.sql` | **✅ مطبّق** 2026-11-16 بعد #53 بدقائق (تصحيح كشفه اختبار T6: فحص السلسلة كان يرتّب بـ`created_at, id` وكل قيود المعاملة الواحدة تتشارك نفس الطابع الزمني فتظهر انقطاعات وهمية — أُضيف `ledger_seq` تصاعدي وفريد + ترتيب الفحص عليه + `setval` بعد أكبر رقم رجعي. الملف الأصلي #53 حُدّث ليتطابق، والاختبارات الست أعيدت ونجحت) | ضمن #53 |

**استثناء مرسّخ:** المدير قرر 2026-11-14 أن **الحسابات كلها تجريبية**، فلا نسخة احتياطية مطلوبة قبل migration #37 (إضافات فقط: عمود + ٣ دوال، بلا حذف ولا تعديل بيانات). تنطبق نفس القاعدة على #45-#47 (إضافات/تضييق فقط، بلا حذف بيانات).

**عدد «غير مُتحقَّق»:** ٦. تُحسم كلها بنسخة `pg_dump` (enums + grants).

---

## 3.5) سجل نشر الدوال السحابية (Edge Functions)

| # | الدالة | النسخة | التاريخ | التغيير | التحقق |
|---|---|---|---|---|---|
| F01 | `livekit-token` | 7 → **8** | 2026-11-15T10:42:16Z | فحص الحظر + `check_privacy_permission(...,'enter_rooms')` قبل إصدار توكن الصوت | الملف المنزَّل من الإنتاج مطابق SHA256 للملف المحلي (٦٨١١ بايت) · استدعاء بمفتاح anon رجّع `401 INVALID_TOKEN` أي أن الدالة **أقلعت** ولم ترجع `BOOT_ERROR` |
| F02–F20 | ١٩ دالة: `admin-create-host`, `admin-create-support`, `admin-delete-user`, `admin-manage-host`, `daily-bonus`, `deposit-request`, `game-aviator`, `game-dice`, `game-plinko`, `game-slots`, `game-wheel`, `gift-send`, `livekit-token`, `room-join`, `room-leave`, `room-owner-action`, `social-push`, `withdrawal-request`, `agent-phone-login` | → **M2.4** | 2026-11-16 | استبدال الحد الذاكري بحد قاعدي: `rateLimitByUser` أصبح async يستدعي `check_rate_limit` (#48)؛ `agent-phone-login` يحدّ بـIP عبر `checkDbRateLimit` (20/15د)؛ fail-open عند تعطل القاعدة (استمرارية الخدمة) | `Deployed Functions` لكل دالة · **إثبات طرف-إلى-طرف**: استدعاء `agent-phone-login` ببيانات خاطئة رجّع `401 INVALID_CREDENTIALS` **وسُجّل عدّاد** `agent_phone_login:ip:150.228.106.6` في `rate_limit_buckets` (count=1, max=20, window=900s) |
| F21 | **كل الدوال الـ٣٥** (٣٤ قائمة + `admin-moderation` الجديدة) | `_shared/supabase.ts` → **2.1.0** | 2026-11-16 | M2.5: دالة `admin-moderation` موحّدة (٩ إجراءات: كلمات/إعدادات/استثناءات/عقوبات/مراجعة بلاغ/مراجعة اعتراض عبر RPC القاعدية) + تحديث `authenticate()`: **استعادة تلقائية للحظر المؤقت المنتهي** قبل الرفض (متسق مع `is_account_active`) | نشر السكربت اكتمل exit=0 للـ٣٥ · **إثبات إقلاع**: `admin-moderation` بتوكن غير صالح رجّع `401 INVALID_TOKEN` · `agent-phone-login` بعد التحديث بلغ منطق التحقق (`400 INVALID_BODY`) أي لا `BOOT_ERROR` · ملاحظة: فشل حزم عابر واحد (esm.sh 521) عند أول محاولة حُل بإعادة المحاولة |
| F22 | 7 دوال: `wallet`, `daily-bonus`, `game-wheel`, `game-dice`, `game-aviator`, `game-plinko`, `game-slots` | `game-engine.ts` → رصيد Coin | 2026-11-17 | M3.7: محرك الألعاب ودوال الحافة تقرأ وتتحقق من `balance_gold` (كانت `game_points` = 0 للجميع بعد #56 فكانت كل لعبة سترفض الرهان)؛ الردود تُرجع `balance_gold` بدل `game_points`؛ `wallet` حذف `point` من الرصيد؛ `daily-bonus` يعيد `currency:'gold'` | `Deployed Functions` لكل الدوال السبع · اختبارات قاعدية مستقلة لـ`play_game_with_points` (خسارة/ربح/تكرار/رصيد غير كافٍ) نجحت قبل النشر · `tsc --noEmit` نظيف للتطبيق واللوحة · اختبارات التطبيق 90/90 |
| F23 | 3 دوال: `deposit-request`, `deposit-approve`, `withdrawal-approve` | آلة حالات M4 | 2026-11-17 | M4: `deposit-request` يتحقق مبكرًا من الشبكة (trc20/bep20) وصيغة الهاش/العنوان قبل نداء الـRPC؛ `deposit-approve` يقبل الأفعال review/request_info/fail إضافة إلى approve/reject؛ `withdrawal-approve` يقبل إضافة processing (توافق خلفي كامل مع أفعال approve/reject القديمة) | `Deployed Functions` للدوال الثلاث · **إثبات إقلاع**: `deposit-request` و`withdrawal-approve` بتوكن غير صالح رجّعا `401 INVALID_TOKEN` (لا BOOT_ERROR) · اختبارات قاعدية 25/25 (#61) تشغّل نفس مسارات الدالتين |

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
