#!/bin/bash
# ============================================================================
# Wattar — سكربت نشر Edge Functions على Supabase
# ============================================================================
# الاستخدام:
#   ./deploy-functions.sh <project-ref>
#
# المتطلبات:
#   - Supabase CLI مثبت (npm install -g supabase)
#   - تم تسجيل الدخول (supabase login)
# ============================================================================

set -e

PROJECT_REF=${1:-}
if [ -z "$PROJECT_REF" ]; then
  echo "❌ استخدم: $0 <project-ref>"
  echo "   project-ref تجده في إعدادات Supabase → API Settings"
  exit 1
fi

FUNCTIONS_DIR="$(cd "$(dirname "$0")" && pwd)/functions"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/supabase/functions"
cp -R "$FUNCTIONS_DIR/." "$TEMP_DIR/supabase/functions/"
cat > "$TEMP_DIR/supabase/config.toml" <<'EOF'
project_id = "wattar"
EOF

echo ""
echo "📤 نشر الـ Edge Functions..."

FUNCTIONS=(
  "wallet"
  "deposit-request"
  "deposit-approve"
  "withdrawal-request"
  "withdrawal-approve"
  "transfer"
  "gift-send"
  "daily-bonus"
  "room-join"
  "room-leave"
  "room-owner-action"
  "livekit-token"
  "game-wheel"
  "game-dice"
  "game-aviator"
  "game-plinko"
  "game-slots"
  "admin-create-agent"
  "admin-create-host"
  "agent-phone-login"
  "admin-set-agent-status"
  "host-application-review"
  "admin-manage-host"
  "admin-set-rtp"
  "admin-set-user-status"
  "admin-force-outcome"
  "admin-credit-agent"
  "social-push"
  "delete-account"
  "auth-send-phone-otp"
  "auth-sign-up-email"
  "admin-delete-user"
  "admin-reset-user-password"
)

for fn in "${FUNCTIONS[@]}"; do
  echo "  → نشر $fn..."
  (cd "$TEMP_DIR" && supabase functions deploy "$fn" --no-verify-jwt --project-ref "$PROJECT_REF")
done

echo ""
echo "✅ تم نشر جميع الـ Edge Functions بنجاح! (${#FUNCTIONS[@]} دالة)"
echo ""
echo "🔑 أسرار إضافية (اختياري — لتفعيل الصوت الحي في الغرف):"
echo "   supabase secrets set LIVEKIT_URL=wss://xxxx.livekit.cloud LIVEKIT_API_KEY=xxxxxxxx LIVEKIT_API_SECRET=xxxxxxxx --project-ref $PROJECT_REF"
echo "   بدون هذه الأسرار تعمل الغرف بشكل كامل بدون صوت (شات + مقاعد + هدايا)"
echo ""
echo "🌐 الـ Functions ستعمل على: https://$PROJECT_REF.functions.supabase.co/functions/v1/<name>"
