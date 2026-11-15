# جرد مخطط قاعدة البيانات — M0.2 (مرحلة أولى: جرد فقط)
**التاريخ:** 2026-11-14 · **الحالة:** جرد ثابت من الملفات. **لم يُنقل ولم يُحذف ولم يُطبّق أي شيء.**

> هذا الملف لا يقول «ما هو مطبّق». يقول **ما هو مكتوب في المستودع**. الفرق بينهما يُغلق بـ`diagnostics/00_environment_probe.sql`.

---

## 1) تحذير: أربع نسخ من المخطط الأساسي، وثلاث منها متعارضة

| الملف | الأسطر | الحجم |
|---|---|---|
| `watar_schema.sql` (جذر المشروع، بلا حرف t مزدوج) | ٧٤٩ | 43 KB |
| `wattar_schema.sql` (جذر المشروع) | ٨٧٦ | 49 KB |
| `wattar-docs/wattar_schema.sql` | ١٠٦٠ | 56 KB |
| `التعديل الجديد للمشروع/wattar-docs/wattar_schema.sql` (مجلد مهمَل) | ٨٩٤ | 50 KB |

**المشكلة:** لا توجد نسخة واحدة يمكن تسميتها «مصدر الحقيقة». الفروق ليست تنسيقية فقط؛ عدد الأسطر يعني جداول وسياسات مختلفة.
**القرار المقترح (لا يُنفّذ بدون موافقتك):** تُعتمد نسخة واحدة بعد مطابقتها مع قاعدة البيانات الفعلية، وتُؤرشف البقية داخل `wattar-docs/archive/schema/` بلا حذف.

---

## 2) ملفات الترقية (٣٥ ملفاً) — جرد واقعي

| # | الملف | أسطر | الغرض من العنوان | جداول تُنشئها | عدد الدوال | شرط الترتيب المذكور في الملف |
|---|---|---|---|---|---|---|
| 1 | `patch_admin_account_controls.sql` | ١٤٧ | ضوابط آمنة لحسابات الاختبار الإدارية | — | ٢ | بعد `patch_admin_audit_controls` وكل مخطط المحفظة/المجتمع |
| 2 | `patch_admin_agent_controls.sql` | ١١٤ | تفعيل/تعليق/حظر الوكلاء بتدقيق | — | ١ | بعد `patch_admin_audit_controls` |
| 3 | `patch_admin_audit_controls.sql` | ٢٤٥ | تغيير حالة المستخدم بتدقيق + `is_admin` | — | ٣ | بعد كل المخططات بما فيها `wallet_economy` |
| 4 | `patch_admin_host_management.sql` | ١١٣ | تعيين/تعليق مضيفات حقيقيات | — | ١ | بعد `host_program` + `audit_controls` |
| 5 | `patch_admin_rls.sql` | ٦١ | تمكين وصول لوحة الإدارة | — | ١ | أول أدمن يجب أن يكون `admin` أو `super_admin` |
| 6 | `patch_agent_dashboard_access.sql` | ٢٢٦ | وصول وكيل محدود للمستخدمين والمهام المالية | — | ٦ | بعد `wallet_economy` + `audit_controls` |
| 7 | `patch_agent_permissions.sql` | ١٠١ | إدارة عمولة/سعر صرف/صلاحيات الوكيل بتدقيق | — | ١ | بعد `audit_controls` ومخطط الوكيل |
| 8 | `patch_auth_profile_trigger.sql` | ٤٤ | إنشاء `public.users` تلقائياً عند تسجيل Auth | — | ١ | قاعدة موجودة مسبقاً |
| 9 | `patch_financial_rls.sql` | ٧ | السجلات المالية تُكتب بـ`service_role` فقط | — | ٠ | — |
| 10 | `patch_host_pending_accounts.sql` | ٢١ | تتبع حسابات مضيفات أنشأها الأدمن | — | ٠ | — |
| 11 | `patch_host_program.sql` | ١٩٢ | طلبات اعتماد مضيفات + `verified_hosts` | `host_applications`, `verified_hosts` | ٢ | بعد `audit_controls` + `social_profiles_posts` |
| 12 | `patch_membership_wallet_type.sql` | ٣ | نوع محفظة للعضوية | — | ٠ | بعد المحفظة، **قبل** `memberships_xp_acceleration` |
| 13 | `patch_memberships_xp_acceleration.sql` | ٢٧٩ | عضويات VIP بالCoin + تعزيز XP | `membership_plans`, `membership_purchases` | ٢ | بعد `audit_controls` وكل المحفظة |
| 14 | `patch_notification_inbox.sql` | ٢٦٥ | إشعارات داخل التطبيق للأحداث الاجتماعية والمالية | `user_notifications` | ١ | بعد `social_foundation` + `wallet_economy` + برنامج المضيفات |
| 15 | `patch_paid_messaging.sql` | ٨٤٨ | رسائل خاصة مدفوعة + برنامج مضيفات منفصل عن التوثيق | `host_intro_templates`, `host_outreach_deliveries`, `host_program_members`, `private_message_settings` | ١٣ | بعد `social_foundation` + `host_program` + المحفظة |
| 16 | `patch_paid_messaging_wallet_types.sql` | ٥ | قيم enum لأنواع المحفظة | — | ٠ | **قبل** `paid_messaging` |
| 17 | `patch_platform_activity_log.sql` | ٣٨٤ | سجل نشاط يحفظ الخصوصية | `platform_activity_log` | ٣ | بعد المجتمع والمحفظة والمضيفات والغرف |
| 18 | `patch_profile_editing.sql` | ١١٤ | تعديل ذاتي آمن للملف + صور رمزية عامة | — | ١ | بعد فحص تكرار اسم المستخدم |
| 19 | `patch_public_auth_rate_limits.sql` | ٨٧ | حد طلبات خادمي للتسجيل وOTP | `public_auth_rate_limits` | ١ | بعد المخطط الأساسي |
| 20 | `patch_room_access.sql` | ١٢٣ | وصول آمن للغرف العامة | — | ١ | قاعدة موجودة مسبقاً |
| 21 | `patch_room_owner_moderation.sql` | ٣٢٨ | كتم/إشراف مالك الغرفة + تدقيق | `room_chat_mutes`, `room_moderation_audit` | ٣ | بعد `wattar_schema` + `social_foundation` |
| 22 | `patch_room_presence.sql` | ١٦٦ | حضور المستمعين وإشعارات دخول/خروج | `room_presence` | ٠ | بعد `social_foundation` + `room_access` + `room_realtime` |
| 23 | `patch_room_realtime.sql` | ٣٨ | تفعيل Realtime للغرف | — | ٠ | آمن لإعادة التشغيل |
| 24 | `patch_slots_enum.sql` | ٤ | قيمة enum للعبة Slots | — | ٠ | بعد `v2_social`، **قبل** `slots_game_config` |
| 25 | `patch_slots_game_config.sql` | ٢٢ | إعداد Slots بنقاط لعب مجانية فقط | — | ٠ | بعد `slots_enum` |
| 26 | `patch_social_foundation.sql` | ١٠٨٠ | أصدقاء/حظر/بلاغات/محادثة/دعوات غرف/تحديات نرد | ٩ جداول | ٢٥ | بعد `wattar_schema` |
| 27 | `patch_social_profiles_posts.sql` | ٢٤٤ | ملفات عامة + منشورات صور دائمة | `user_posts` | ٨ | بعد `v2_social` + `user_onboarding_privacy` |
| 28 | `patch_store_missions.sql` | ٣٠٦ | مهام يومية بنقاط لعب وXP فقط | `daily_mission_claims`, `daily_missions` | ٤ | بعد `wallet_economy`، **قبل** `audit_controls` |
| 29 | `patch_support_role.sql` | ٣ | دور دعم بأقل صلاحية | — | ٠ | **قبل** `support_tickets` |
| 30 | `patch_support_tickets.sql` | ٣٥٢ | تذاكر دعم خاصة وسجل رسائل | `support_ticket_messages` | ٧ | بعد `support_role` + `audit_controls` + الأساس |
| 31 | `patch_three_currency_economy.sql` | ١٥٨ | إظهار Point وCoin وDiamond | — | ١ | بعد `wallet_economy`، **قبل** تدقيق الأدمن |
| 32 | `patch_user_onboarding_privacy.sql` | ٣٦٧ | إكمال ملف إلزامي + خصوصية للأصدقاء | — | ٨ | بعد `v2_social` |
| 33 | `patch_wattar_v2_social.sql` | ١٤٤٩ | تقدم اجتماعي/قصص/متابعة/مجموعات وكلاء/XP | ١٠ جداول | ٢٦ | بعد `wattar_schema` + `social_foundation` |
| 34 | `patch_wattar_v2_wallet.sql` | ٥٦٢ | Coin + ودائع يدوية | `deposit_methods` | ٤ | بعد الأساس + المجتمع |
| 35 | `patch_wattar_v2_wallet_economy.sql` | ١١١٥ | اقتصاد المحفظة/سحب Diamond/تحويلات | `agent_coin_ledger`, `diamond_coin_conversions`, `diamond_withdrawals` | ١٢ | بعد `v2_wallet` + `v2_social` |

**ملاحظة:** «عدد الدوال» يشمل الدوال المساعدة والمكررة بالاسم عبر ملفات مختلفة. لا يعني ٣٤ دالة Edge.

---

## 3) ترتيب مقترح مستخرج من شروط الملفات (غير مؤكد)

هذا **ترتيب منطقي مشتق من تعليقات الملفات نفسها**، وليس تأكيداً لما طُبّق:

1. `wattar_schema.sql` (النسخة المعتمدة لاحقاً)
2. `patch_auth_profile_trigger.sql`
3. `patch_social_foundation.sql`
4. `patch_wattar_v2_social.sql`
5. `patch_user_onboarding_privacy.sql`
6. `patch_social_profiles_posts.sql`
7. `patch_wattar_v2_wallet.sql`
8. `patch_wattar_v2_wallet_economy.sql`
9. `patch_three_currency_economy.sql`
10. `patch_paid_messaging_wallet_types.sql`
11. `patch_membership_wallet_type.sql`
12. `patch_store_missions.sql`
13. `patch_paid_messaging.sql`
14. `patch_memberships_xp_acceleration.sql`
15. `patch_host_program.sql`
16. `patch_notification_inbox.sql`
17. `patch_platform_activity_log.sql`
18. `patch_room_access.sql`
19. `patch_room_realtime.sql`
20. `patch_room_presence.sql`
21. `patch_room_owner_moderation.sql`
22. `patch_support_role.sql`
23. `patch_support_tickets.sql`
24. `patch_admin_audit_controls.sql`
25. `patch_admin_rls.sql`
26. `patch_admin_account_controls.sql`
27. `patch_admin_agent_controls.sql`
28. `patch_admin_host_management.sql`
29. `patch_agent_dashboard_access.sql`
30. `patch_agent_permissions.sql`
31. `patch_host_pending_accounts.sql`
32. `patch_profile_editing.sql`
33. `patch_public_auth_rate_limits.sql`
34. `patch_financial_rls.sql`
35. `patch_slots_enum.sql`
36. `patch_slots_game_config.sql`

**لا تعتمد هذا الترتيب للتنفيذ.** هو فقط أساس للمقارنة مع نتائج Probe.

---

## 4) المخاطر المكتشفة في هذه الخطوة

| # | الخطر | الأثر | التخفيف |
|---|---|---|---|
| 1 | ٣ نسخ أساسية متعارضة | إعادة بناء خاطئة أو فقدان جداول | مطابقة مع DB قبل اعتماد أي نسخة |
| 2 | ترتيب ٣٥ patch غير موثّق | تطبيق مكرر أو ناقص | Probe + سجل migrations مرقّم |
| 3 | ملفات «قبل/بعد» صغيرة (٣–٧ أسطر) | يمكن تطبيقها مرتين بلا أثر، أو تفويتها | تسجيلها كـmigration ذرّية |
| 4 | تعارض تسمية `watar_schema.sql` و`wattar_schema.sql` | التباس عند البناء | أرشفة الأولى بعد الاعتماد |
| 5 | جداول مؤجلة موجودة (`game_challenges`, `game_challenge_players`) | نطاق PK مؤجل لكن الجداول قائمة | تُترك بلا واجهة ولا تفعيل، وتُوثّق كمؤجلة |

---

## 5) نتيجة المطابقة مع Probe (2026-11-14)

وصل ناتج `diagnostics/00_environment_probe.sql` وطوبق مع هذا الجرد. التفاصيل الكاملة في `SCHEMA_RECONCILIATION_2026-11.md`. الخلاصة:

| البند | النتيجة |
|---|---|
| جداول القاعدة | ٥٧ |
| جداول معرّفة في SQL المعتمد | ٦١ (بعد استثناء مجلد `التعديل الجديد للمشروع/` المهمَل) |
| ناقص فعلاً | ٤ جداول فقط: `private_message_settings`, `host_program_members`, `host_intro_templates`, `host_outreach_deliveries` |
| زائد | صفر |
| سبب النقص | `patch_paid_messaging.sql` **لم يُطبّق إطلاقاً** |
| أثر جانبي حرج | الواجهة تنادي ١٢ دالة من هذا الملف → المحادثة الخاصة معطّلة |

**تصحيح للجرد:** الرقم ٦٢ السابق كان يشمل `user_devices` من المجلد المهمَل. العدد المعتمد **٦١**.

---

## 6) الخطوة التالية

1. **نسخة احتياطية + `pg_dump`** — شرط لا يُتجاوز قبل أي migration.
2. إنشاء `supabase/migrations/` من الـdump الفعلي (لا من الأسماء).
3. أرشفة نسخ المخطط المكررة بلا حذف داخل `wattar-docs/archive/schema/`.
4. تسجيل الـ٣٥ patch في `MIGRATIONS_REGISTRY.md` بحالتها.

لن أنفّذ ٢–٣ قبل موافقتك ووصول الـdump، لأنها تمسّ بنية القاعدة.
