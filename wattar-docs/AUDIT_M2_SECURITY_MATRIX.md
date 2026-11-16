# مصفوفة تدقيق الأمان — M2.1 / M2.2

**التاريخ:** 2026-11-15
**المشروع:** `vczyjbqixqzositlkfkn` (production, PG 17.11, ap-south-1)
**الطريقة:** استعلامات قراءة فقط على كتالوج Postgres الحقيقي (`pg_class`, `pg_policies`,
`pg_proc`, `aclexplode`, `pg_index`). لا استنتاج من الكود ولا من ملفات الهجرة.
**المرجع في الخطة:** `EXECUTION_PLAN.md` ← M2.1 (مصفوفة RLS) و M2.2 (مصفوفة الدوال).

---

## 1) تغطية RLS

| القياس | النتيجة |
|---|---|
| جداول `public` من نوع جدول | **62** |
| RLS مُفعّل | **62 / 62** |
| RLS إجباري (`FORCE ROW LEVEL SECURITY`) | **0 / 62** |
| إجمالي السياسات | **64** |
| سياسات كتابة (INSERT/UPDATE/DELETE/ALL) | **14** |
| سياسات كتابة مشبوهة (دور `anon` أو شرط `true`) | **0** |

**ملاحظة على `FORCE RLS = 0`:** مالك الجدول (`postgres`) يتجاوز RLS بحكم الملكية،
و`service_role` يتجاوزها بـ `bypassrls=true`. هذا هو النموذج المعتمد في Supabase،
وليس ثغرة، لكنه يعني أن أي دالة `SECURITY DEFINER` تعمل بصلاحية المالك تتجاوز RLS
أيضاً — لذلك تدقيق الدوال (القسم 3) هو الضابط الفعلي، لا RLS وحدها.

### 1.1 جداول بلا أي سياسة (23 جدولاً) — التصميم: RPC فقط

`account_cleanup_storage, agent_group_memberships, agent_group_messages, agent_groups,
game_points_ledger, host_intro_templates, host_outreach_deliveries, host_program_members,
otp_codes, private_message_settings, progress_events, public_auth_rate_limits, push_tokens,
referrals, room_chat_mutes, room_moderation_audit, room_presence, stories,
support_ticket_messages, support_tickets, user_follows, user_posts, user_sessions`

**التحقق:** RLS مفعّل + صفر سياسات ⇒ `anon` و`authenticated` لا يقرأون ولا يكتبون أي صف
مباشرة (الافتراض هو الرفض). الوصول الوحيد الممكن عبر دوال `SECURITY DEFINER` التي
تتحقق من `auth.uid()` داخلياً. تم فحص كل دالة من هذه الدوال في القسم 3.

**الاستثناء المقصود:** لا يوجد. الجداول المالية الحساسة (`wallet_transactions`,
`diamond_withdrawals`) ليست في القائمة لأن لها سياسة قراءة ذاتية فقط.

---

## 2) صلاحيات الجداول (GRANT) — الخطر الأكبر المكتشف

RLS تحمي الصفوف، لكنها **لا تحمي من `TRUNCATE`**، ولا تمنع منح صلاحيات كتابة غير لازمة.
الوضع الحالي الموروث من `GRANT ALL` الافتراضي:

| الدور | جداول يملك عليها SELECT | جداول يملك عليها INSERT/UPDATE/DELETE |
|---|---|---|
| `anon` | 21 | 21 (بما فيها `users`, `wallet_transactions`, `deposits`, `withdrawals`, `transfers`) |
| `authenticated` | 41 | 21 (نفس القائمة) |

القائمة الكاملة لصلاحيات `anon`: `admin_settings, agent_groups, agents, deposits,
game_bets, game_configs, game_rounds, gift_transactions, gifts, leaderboards,
membership_plans, otp_codes, referrals, room_messages, room_seats, rooms, transfers,
user_sessions, users, wallet_transactions, withdrawals`.

كذلك يملك الدوران `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` على معظم الجداول
(`MAINTAIN` صلاحية جديدة في PG 17 تشمل `VACUUM/ANALYZE/REINDEX/CLUSTER`).

**لماذا لم تُستغل بعد؟** لأن كل سياسة كتابة تتحقق من `auth.uid()`، و`anon` بلا هوية ⇒
الشرط يفشل. أي سياسة مستقبلية بدور `public` وشرط بسيط ستفتح الباب فوراً. هذا ما نغلقه.

**لماذا ليس خطراً نظرياً فقط؟** `anon` يملك `INSERT` على `users` و`wallet_transactions`
و`transfers`. RLS هي خط الدفاع الوحيد بين صفر مصادقة ودفتر أستاذ مالي. طبقة واحدة
ليست كافية لمثل هذا الأصل.

**الإصلاح:** المهاجرة #46 — سحب كل شيء من `anon` في `public`، وسحب الصلاحيات
غير المستخدمة من `authenticated`، مع `ALTER DEFAULT PRIVILEGES` للأشياء المستقبلية.
لا يُسحب من `authenticated` أي شيء يستخدمه التطبيق أو لوحة الإدارة (SELECT + كتابة
الجداول الإدارية الخمسة تبقى، وتُضبط بسياسات `is_admin()`).

---

## 3) مصفوفة الدوال

| القياس | النتيجة |
|---|---|
| دوال `public` | **360** (منها ~260 دوال امتدادات: `pg_trgm`, GiST) |
| `SECURITY DEFINER` | **133** |
| `SECURITY DEFINER` بلا `search_path` | **0** ✅ |
| `SECURITY DEFINER` قابلة للتنفيذ من `anon` | **50** |
| دوال مخصّصة قابلة للتنفيذ من `anon` | **~45** (الباقي دوال امتدادات) |

### 3.1 دوال `SECURITY DEFINER` خطرة الشكل — نتيجة الفحص

| الدالة | الحالة | الحكم |
|---|---|---|
| `award_user_xp` | تتحقق `auth.role() <> 'service_role'` ثم ترفض | آمنة، لكن المنح لـ`anon` زائد |
| `clear_anonymized_wallet_withdrawals` | دالة تريغر (`RETURNS trigger`) | غير قابلة للاستدعاء عبر PostgREST |
| `create_room_seats` | دالة تريغر | غير قابلة للاستدعاء |
| `handle_new_auth_user` | دالة تريغر | غير قابلة للاستدعاء |
| `record_adult_consent` | دالة تريغر | غير قابلة للاستدعاء |
| `is_admin`, `is_wattar_blocked_between` | تعتمد `auth.uid()` | آمنة مع `anon` (null ⇒ false) |
| باقي `list_*` / `*_my_*` | كلها تبدأ بـ`auth.uid()` وترفض عند null | آمنة |
| `increment_user_stat`, `update_user_deposit_stats`, `generate_referral_code`, `set_referral_code` | بلا `SECURITY DEFINER` ⇒ تعمل بصلاحية المستدعي وRLS | غير خطرة، لكن يجب سحبها من `anon` |

**الخلاصة:** لا توجد دالة `SECURITY DEFINER` واحدة تمنح `anon` تجاوزاً فعلياً. الخطر
كان في *اتساع سطح الهجوم* لا في ثغرة قائمة.

### 3.2 ملاحظة `search_path`
ثلاث دوال تستخدم `SET search_path = public` بدون `pg_temp`:
`create_room_seats`, `handle_new_auth_user`, `record_adult_consent`.
كلها دوال تريغر لا تستدعي دوالاً قابلة للاستبدال، لذا الخطر منخفض، لكن المعيار
المعتمد في المشروع هو `public, pg_temp` — تُوحَّد في المهاجرة #46.

---

## 4) عيوب السياسات المكتشفة (تُغلق في #47 و#46)

| # | العنصر | العيب | الأثر |
|---|---|---|---|
| P1 | `room_messages_insert` (INSERT, `{public}`) | يكفي أن يكون المستخدم صاحب الرسالة والغرفة مفتوحة/عامة — لا كتم، لا حظر، لا حدّ معدل | سبام مباشر إلى أي غرفة عامة عبر PostgREST |
| P2 | `wattar_room_messages_invited_insert` | تكرار لـ P1 بمسار الدعوات | نفس الأثر |
| P3 | `room_seats_claim` (UPDATE) | يسمح للمستخدم بتعديل **أي عمود** في صفّه: `is_owner_seat`, `is_mic_on`, `joined_at` | انتحال شارة «مالك الغرفة» وتفعيل ميكروفون دون إذن |
| P4 | لا قيد تفرّد على `room_seats(room_id, user_id)` | يمكن لمستخدم احتلال عدة مقاعد في نفس الغرفة | إفساد عدّاد المتحدثين والواجهة |
| P5 | `wattar_rooms_invited_read` | الشرط `i.room_id = i.id` (مقارنة الجدول بنفسه) | سياسة ميتة تماماً — لا تحمي ولا تفتح، لكنها تدلّ على خطأ نسخ |
| P6 | `room_messages` بلا حدّ معدل في القاعدة | الاعتماد على العميل | إغراق الغرفة |
| P7 | `users` بلا `UPDATE` مقنّن للعميل | التطبيق يستخدم RPC (`update_my_profile`) لكن المنح ما زال قائماً | سطح هجوم زائد (يُغلق بسحب الصلاحية) |
| P8 | `ALTER DEFAULT PRIVILEGES` المضبوطة في #46 تمنح `authenticated` تنفيذ **كل دالة جديدة** ينشئها `postgres` تلقائياً | اكتُشف 2026-11-16 أثناء M2.4: دوال المخاطر الثلاث (`record_risk_event`, `register_device_fingerprint`, `get_risk_score`) حصلت على `authenticated=X` عند الإنشاء رغم أن المنح المقصود كان `service_role` فقط، و`REVOKE … FROM PUBLIC` لا يزيل منحاً صريحاً كهذا | أي دالة «خدمة فقط» مستقبلية ستبقى مفتوحة للمستخدمين إن لم تُسحب صراحةً — **القاعدة منذ #48: سحب `EXECUTE` من `PUBLIC, anon, authenticated` صراحةً في كل دالة خدمة-فقط** (أُغلقت الحالة الحالية في #48 وأُثبتت بالاختبار 07 T10) |

---

## 5) خطة الإغلاق

| الخطوة | الملف | ما يغلقه |
|---|---|---|
| #46 `patch_harden_table_grants.sql` | صلاحيات + `search_path` | القسم 2 كاملاً، 3.2، P7 |
| #47 `patch_room_rpc.sql` | `claim_room_seat` / `leave_room_seat` / `set_room_mic` / `send_room_message` + سحب الكتابة المباشرة | P1–P6 |
| #48 `patch_rate_limiting_risk.sql` | ٤ جداول حد/مخاطر + `check_rate_limit`/`record_risk_event`/`register_device_fingerprint`/`get_risk_score` + سحب `EXECUTE` من العميل لدوال المخاطر | P8 (الحالة الحالية) |
| #49 `patch_wire_rate_limit_rpc.sql` | ربط الحد بدوال الغرف (مقعد ١٠/د، ميكروفون ٢٠/د، رسائل ٣٠/د) | P6 (تعزيز) |
| `diagnostics/06_room_rpc_functional_test.sql` | إثبات سماح/رفض لكل حالة + T21 حد المقاعد | بوابة M2.3 |
| `diagnostics/07_rate_limit_risk_functional_test.sql` | إثبات الحد والمخاطر (١٨ حالة) | بوابة M2.4 |
| تحديث `app/room/[id].tsx` | استبدال 4 كتابات مباشرة بـ RPC | إغلاق ثقة العميل |
| نشر F02–F20 (١٩ دالة سحابية) | استبدال الحد الذاكري بحد قاعدي | الحد يصمد عبر نسخ الدوال |

**ما لا تدّعيه هذه المصفوفة:** لا تُثبت منع إساءة استخدام كامل (Rate limiting عام،
Risk scoring، Moderation) — تلك M2.4 وM2.5 وستُقاس باختباراتها الخاصة.
