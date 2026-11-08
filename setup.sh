#!/bin/bash
# ============================================================================
# Wattar — سكربت الإعداد الكامل
# يقوم بإعداد: Supabase + Edge Functions + Admin + App
# ============================================================================
# الاستخدام:
#   ./setup.sh
# ============================================================================

set -e

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║        Wattar — سكربت الإعداد الكامل                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# 1) Supabase
echo "📦 [1/4] إعداد Supabase..."
echo ""
echo "   1. اذهب إلى https://supabase.com وأنشئ مشروعًا جديدًا"
echo "   2. افتح SQL Editor والصق محتوى:"
echo "      wattar-docs/wattar_schema.sql"
echo "   3. نفّذ الـ SQL"
echo "   4. أنشئ Storage Buckets: avatars, deposit-proofs, gift-icons"
echo "   5. أنشئ مستخدم Auth للأدمن (Email/Password)"
echo "   6. نفّذ في SQL:"
echo "      INSERT INTO users (id, email, username, role, status)"
echo "      VALUES ('<user-uuid>', '<email>', 'admin', 'super_admin', 'active')"
echo "      ON CONFLICT (id) DO UPDATE SET role = 'super_admin';"
echo ""
read -p "   هل أنهيت إعداد Supabase؟ (y/N) " yn
if [ "$yn" != "y" ] && [ "$yn" != "Y" ]; then
  echo "❌ أكمل إعداد Supabase أولاً ثم أعد تشغيل السكربت"
  exit 1
fi

echo ""
echo "   أدخل بيانات Supabase:"
read -p "   Supabase URL (https://xxx.supabase.co): " SUPABASE_URL
read -p "   Supabase Anon Key: " SUPABASE_ANON_KEY
read -p "   Project Ref (for functions deploy): " PROJECT_REF

# 2) Edge Functions
echo ""
echo "📦 [2/4] نشر الـ Edge Functions..."
if [ -n "$PROJECT_REF" ]; then
  ./wattar-functions/deploy-functions.sh "$PROJECT_REF"
else
  echo "   ⚠️  تخطي — أدخل project-ref يدويًا لاحقًا"
fi

# 3) Admin Dashboard
echo ""
echo "📦 [3/4] إعداد لوحة الأدمن..."
cd wattar-admin
cat > .env.local << EOF
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
echo "   ✅ تم إنشاء .env.local"
echo "   تثبيت الحزم..."
npm install --silent 2>&1 | tail -5
echo "   ✅ تم تثبيت الحزم"
cd ..

# 4) Mobile App
echo ""
echo "📦 [4/4] إعداد تطبيق المستخدم..."
cd wattar-app
cat > .env << EOF
EXPO_PUBLIC_SUPABASE_URL=$SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
EOF
echo "   ✅ تم إنشاء .env"
echo "   تثبيت الحزم..."
npm install --silent 2>&1 | tail -5
echo "   ✅ تم تثبيت الحزم"
cd ..

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║        ✅ اكتمل الإعداد بنجاح!                            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "🚀 للتشغيل:"
echo ""
echo "   لوحة الأدمن:"
echo "     cd wattar-admin && npm run dev"
echo "     → http://localhost:5174"
echo ""
echo "   تطبيق المستخدم (Android):"
echo "     cd wattar-app && npx expo start --dev-client"
echo ""
echo "   بناء APK للتحميل المباشر:"
echo "     cd wattar-app && eas build -p android --profile preview"
echo ""
