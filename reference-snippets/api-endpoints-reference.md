# نقاط الاتصال المذكورة في وثيقة المواصفات الأصلية

هذا الملف ينقل ملخص الـ Endpoints كما ظهر في مواصفات المشروع. بعض الحمولات وأسماء الحقول تحتاج توحيدًا مع المخطط الفعلي قبل الاستخدام؛ التطبيق المرفق يستخدم Supabase JS Client وسياسات RLS بدل طلبات HTTP يدوية.

| المسار | الطريقة | الغرض الموصوف |
|---|---|---|
| `/auth/v1/token?grant_type=password` | POST | تسجيل الدخول بالبريد/كلمة المرور |
| `/rest/v1/tasks` | POST | إنشاء مهمة من المسؤول |
| `/rest/v1/tasks?task_id=eq.{id}` | PATCH | تحديث مهمة |
| `/rest/v1/tasks?select=id,title,status,start_time,admin_instructions` | GET | قراءة المهام |
| `/rest/v1/tasks?task_id=eq.{id}` | PATCH | تحديث حالة المهمة |
| `/rest/v1/tasks?task_id=eq.{id}` | PATCH | حفظ ملاحظة شخصية — في المخطط الأصلي غير آمن بسبب وجودها في نفس جدول المهام |
| `/storage/v1/object/audio-notes` | POST | رفع ملف صوتي؛ المسار الدقيق يحتاج bucket/path صحيحين |
| `/rest/v1/weekly_reviews` | POST | حفظ المراجعة الأسبوعية |
| `/rest/v1/communication_tickets` | POST | إنشاء تذكرة تواصل |
