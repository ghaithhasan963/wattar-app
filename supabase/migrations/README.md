# migrations — مصدر الحقيقة لتغييرات قاعدة البيانات

هذا المجلد مخصّص **فقط** لملفات الـmigration المرقّمة والمُراجعة.
**لا يوجد فيه baseline بعد، وهذا مقصود.**

## لماذا فارغ؟

لأن كتابة baseline يدوياً من أسماء الجداول = إعادة بناء كاذبة. الـbaseline الحقيقي يُستخرج من القاعدة الفعلية بعد نسخة احتياطية:

```bash
# يتطلب جلسة/اتصال قاعدة على جهاز المدير. لا تكتب DATABASE_URL في أي ملف.
supabase db dump --schema public -f supabase/migrations/00000000000000_baseline.sql
```

بديل:
```bash
pg_dump --schema-only --schema=public "$DATABASE_URL" > supabase/migrations/00000000000000_baseline.sql
```

## التسمية

```
YYYYMMDDHHMMSS_short_description.sql
```

## القواعد

1. لا migration بلا نسخة احتياطية مسبقة.
2. لا migration بلا مراجعة وموافقة المدير.
3. لا تعديل على ملف مُطبّق — التصحيح بملف جديد.
4. كل ملف يحدّد: ماذا يفعل، كيف يُلغى، وهل هو آمن للإعادة.
5. لا بيانات مالية تُحذف أو تُعاد كتابتها؛ التصحيح بقيود عكسية.

## المرجع

- الحالة الفعلية للقاعدة: `../wattar-docs/SCHEMA_RECONCILIATION_2026-11.md`
- سجل الـ٣٥ patch والترقيم المقترح: `../wattar-docs/MIGRATIONS_REGISTRY.md`
- جرد المخطط من الملفات: `../wattar-docs/SCHEMA_MANIFEST.md`
