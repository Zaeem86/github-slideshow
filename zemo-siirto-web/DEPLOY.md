<div dir="rtl">

# دليل نشر ZEMO SIIRTO خطوة بخطوة

النتيجة: الموقع يعمل على `https://zemosiirto.fi`، قاعدة البيانات على **Supabase**، والتطبيق على **Vercel**.
المدة التقريبية: ساعة واحدة. كل الخدمات لها خطة مجانية تكفي للبداية.

> 🔐 **قاعدة ذهبية:** المفاتيح السرية (`SUPABASE_SERVICE_ROLE_KEY` ومفاتيح Trustly) لا تُكتب أبداً في الكود ولا في git ولا في محادثة. تُوضع فقط في إعدادات Vercel.

---

## الخطوة 1: إنشاء قاعدة البيانات على Supabase

1. ادخل إلى <https://supabase.com> وأنشئ حساباً، ثم **New project**.
2. الاسم: `zemo-siirto` — المنطقة (Region): **North EU (Stockholm)** — احفظ كلمة مرور قاعدة البيانات في مكان آمن.
3. بعد إنشاء المشروع افتح **SQL Editor** ← **New query**، وانسخ والصق محتوى كل ملف من هذه الملفات **بالترتيب**، واضغط **Run** بعد كل ملف:
   1. `supabase/migrations/20261116000000_base_schema.sql`
   2. `supabase/migrations/20261117000000_driver_jobs_and_earnings.sql`
   3. `supabase/migrations/20261118000000_app_api.sql`
   4. `supabase/migrations/20261119000000_payments_trustly.sql`

   يجب أن تظهر رسالة **Success** بعد كل ملف. إذا ظهر خطأ توقّف وأرسل لي نص الخطأ.

4. من **Project Settings ← API** انسخ ثلاث قيم (ستحتاجها في الخطوة 3):
   - **Project URL** (مثل `https://abcd1234.supabase.co`)
   - **Publishable key** (أو **anon public** في المشاريع القديمة) — عام وآمن
   - **Secret / service_role key** — **سرّي جداً**

## الخطوة 2: إعدادات تسجيل الدخول في Supabase

1. **Authentication ← URL Configuration**:
   - **Site URL:** `https://zemosiirto.fi`
   - **Redirect URLs** أضف:
     - `https://zemosiirto.fi/auth/callback`
     - `https://*.vercel.app/auth/callback` (لروابط المعاينة على Vercel)
2. **Authentication ← Emails ← Confirm signup**: استبدل الرابط في القالب بهذا (حتى يعمل رابط التأكيد حتى لو فُتح في متصفح آخر):
   ```html
   <a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">تأكيد البريد / Vahvista sähköposti</a>
   ```
3. **مهم للإطلاق:** بريد Supabase المدمج محدود بعدد قليل من الرسائل في الساعة. قبل استقبال عملاء حقيقيين اربط بريداً خاصاً من **Authentication ← Emails ← SMTP Settings** (مثل Resend أو Brevo أو بريد استضافتك).

## الخطوة 3: نشر التطبيق على Vercel

1. ادخل إلى <https://vercel.com> بحساب GitHub، ثم **Add New… ← Project** واختر المستودع `github-slideshow`.
2. **Root Directory:** اضغط Edit واختر **`zemo-siirto-web`** (مهم!). Framework سيُكتشف تلقائياً: Next.js.
3. افتح **Environment Variables** وأضف:

   | الاسم | القيمة | ملاحظة |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | عام |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable / anon key | عام |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret / service_role key | 🔐 فعّل **Sensitive** |
   | `APP_URL` | `https://zemosiirto.fi` | بدون `/` في النهاية |

   متغيرات Trustly تُضاف لاحقاً (الخطوة 6). بدونها يبقى زر الدفع البنكي مخفياً ويعمل الدفع التجريبي فقط.
4. اضغط **Deploy** وانتظر حتى ينتهي البناء (2–3 دقائق).
5. **تحقق:** افتح `https://<اسم-مشروعك>.vercel.app/api/health` — يجب أن ترى `"ok": true`.
   إذا كانت قيمة ما `false`:
   - `supabaseConfigured` ← تحقق من المتغيرين `NEXT_PUBLIC_…` ثم أعد النشر (Redeploy).
   - `database` أو `migrationsApplied` ← الخطوة 1.3 لم تكتمل.
   - `serviceKeyConfigured` / `appUrlConfigured` ← المتغيرات في الجدول أعلاه.

> بعد أي تغيير في المتغيرات: **Deployments ← ⋯ ← Redeploy** حتى تُطبَّق.

## الخطوة 4: ربط النطاق zemosiirto.fi

1. في Vercel: **Settings ← Domains** ← أضف `zemosiirto.fi` و `www.zemosiirto.fi`.
2. سيعرض Vercel السجلات المطلوبة. أضفها عند مزوّد النطاق (حيث اشتريت zemosiirto.fi) **بالقيم التي يعرضها Vercel بالضبط** (عادةً سجل `A` للنطاق الرئيسي وسجل `CNAME` لـ `www`).
3. انتظر حتى تظهر علامة ✓ في Vercel (من دقائق حتى 48 ساعة). شهادة HTTPS تُصدر تلقائياً.
4. افتح `https://zemosiirto.fi/api/health` للتأكد.

## الخطوة 5: إنشاء حساب المدير الأول

1. افتح `https://zemosiirto.fi/customer/login` وأنشئ حساباً ببريدك، وأكّد البريد.
2. في Supabase ← **SQL Editor** نفّذ (ضع بريدك):
   ```sql
   update public.profiles set role = 'admin' where email = 'بريدك@example.com';
   ```
3. ادخل من `https://zemosiirto.fi/admin/login`.
4. من **Admin ← Settings** أدخل بيانات الشركة (Y-tunnus، العنوان، IBAN) — تظهر على الفواتير.
5. من **Admin ← Pricing** راجع الأسعار والعمولة.

## الخطوة 6: تفعيل الدفع عبر Trustly (بعد توقيع العقد)

1. وقّع اتفاقية تاجر مع Trustly واحصل على: اسم مستخدم وكلمة مرور الـ API، ومفتاح Trustly العام (للاختبار وللإنتاج).
2. أنشئ زوج مفاتيح على جهازك:
   ```bash
   openssl genrsa -out merchant.key 2048
   openssl rsa -in merchant.key -pubout -out merchant.pub
   ```
   أرسل **`merchant.pub`** فقط إلى Trustly. الملف `merchant.key` سرّي.
3. في Vercel أضف (كلها **Sensitive**):
   `TRUSTLY_ENV=test` · `TRUSTLY_USERNAME` · `TRUSTLY_PASSWORD` · `TRUSTLY_PRIVATE_KEY` (محتوى merchant.key كاملاً) · `TRUSTLY_PUBLIC_KEY` (مفتاح Trustly)
4. أعطِ Trustly عنوان الإشعارات: `https://zemosiirto.fi/api/trustly/notifications`
5. Redeploy، ثم جرّب دفعة كاملة في بيئة اختبار Trustly، وتأكد مع Trustly من أسماء حقول الإشعارات (انظر README ← Payments).
6. عند النجاح: غيّر `TRUSTLY_ENV=production` وضع مفتاح Trustly الخاص بالإنتاج، ثم أوقف الدفع التجريبي في Supabase:
   ```sql
   update public.app_settings set allow_demo_payments = false;
   ```

## قائمة التحقق قبل استقبال أول عميل

- [ ] `/api/health` يعرض `"ok": true` على `https://zemosiirto.fi`
- [ ] تسجيل عميل جديد + تأكيد البريد يعمل
- [ ] طلب تجريبي كامل: عميل ← دفع ← سائق ← فحص استلام ← تسليم ← أرباح ← دفع للسائق
- [ ] بريد SMTP خاص مفعّل (الخطوة 2.3)
- [ ] Trustly يعمل والدفع التجريبي **متوقف**
- [ ] سياسة الخصوصية والشروط والتأمين ومراجعة الضريبة مع مختص فنلندي
- [ ] نسخ احتياطية: Supabase ← Database ← Backups (الخطة المدفوعة تحفظ نسخاً يومية)

## الاختبارات التلقائية

كل تغيير يُرفع إلى GitHub يشغّل تلقائياً (GitHub ← Actions ← `zemo-siirto-web`): فحص الأنواع، ESLint، البناء، 66 فحصاً لقاعدة البيانات، واختبار المتصفح الكامل للبوابات الثلاث والدفع. لا تنشر نسخة فشلت فيها الاختبارات.

</div>
