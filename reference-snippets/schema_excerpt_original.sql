-- مقتطف مخطط قاعدة البيانات من وثيقة المستخدم، محفوظ كمرجع كما ورد معنويًا.
-- تنبيه: لا تشغّل هذا الملف؛ هو مرجع للمقارنة وليس مخططًا صالحًا للتشغيل.
-- يحتوي النص الأصلي على سياسة RLS تشير إلى user_id داخل tasks بينما العمود غير موجود.

-- جدول المستخدمين واستعراض الصلاحيات
CREATE TABLE users (
   user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   username VARCHAR(50) UNIQUE NOT NULL,
   password_hash VARCHAR(255) NOT NULL,
   role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'USER')),
   preferred_language VARCHAR(10) DEFAULT 'ar_FA' CHECK (preferred_language IN ('ar_FA', 'ar_EG', 'en_US')),
   font_size_level INT DEFAULT 3 CHECK (font_size_level BETWEEN 1 AND 6),
   theme_mode VARCHAR(10) DEFAULT 'DARK' CHECK (theme_mode IN ('DARK', 'LIGHT', 'SYSTEM')),
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
   last_login_at TIMESTAMP WITH TIME ZONE
);

-- جدول الأسابيع التنظيمية
CREATE TABLE weeks (
   week_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   start_date DATE NOT NULL UNIQUE,
   end_date DATE NOT NULL UNIQUE,
   is_active BOOLEAN DEFAULT TRUE,
   friday_leisure_message TEXT,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- جدول الفترات الزمنية لليوم
CREATE TABLE periods (
   period_id INT PRIMARY KEY CHECK (period_id IN (1, 2, 3)), -- 1: Morning, 2: Midday, 3: Evening
   name_key VARCHAR(50) NOT NULL,
   start_time_default TIME NOT NULL,
   end_time_default TIME NOT NULL
);

-- جدول المهام اليومية
CREATE TABLE tasks (
   task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   week_id UUID NOT NULL REFERENCES weeks(week_id) ON DELETE CASCADE,
   day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0: Saturday, 6: Friday
   period_id INT NOT NULL REFERENCES periods(period_id),
   title VARCHAR(255) NOT NULL,
   admin_instructions TEXT,
   start_time TIME NOT NULL,
   end_time TIME NOT NULL,
   is_time_editable BOOLEAN DEFAULT FALSE,
   status VARCHAR(20) DEFAULT 'UNSET' CHECK (status IN ('UNSET', 'COMPLETED', 'PARTIAL', 'LAZY')),
   personal_notes TEXT, -- حقل خاص للمستفيد فقط
   display_order INT NOT NULL DEFAULT 1,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- تفعيل سياسة الأمان لحجب الملاحظات الخاصة عن المسؤول (RLS)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "المستفيد يقرأ ويعدل مهامه وملاحظاته"
ON tasks FOR ALL
USING (auth.uid() = user_id);

-- جدول التسجيلات الصوتية اليومية
CREATE TABLE audio_notes (
   note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
   week_id UUID NOT NULL REFERENCES weeks(week_id) ON DELETE CASCADE,
   day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
   file_path VARCHAR(512) NOT NULL,
   duration_seconds INT NOT NULL,
   mime_type VARCHAR(100) NOT NULL,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- جدول تقييم الأداء الأسبوعي
CREATE TABLE weekly_reviews (
   review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
   week_id UUID NOT NULL REFERENCES weeks(week_id) ON DELETE CASCADE,
   accomplished_tasks_summary TEXT,
   accomplishment_reasons TEXT,
   unaccomplished_tasks_summary TEXT,
   unaccomplishment_reasons TEXT,
   improvement_points TEXT,
   next_week_plan TEXT,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
   CONSTRAINT unique_user_week_review UNIQUE (user_id, week_id)
);

-- جدول تذاكر التواصل والطلبات
CREATE TABLE communication_tickets (
   ticket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
   subject VARCHAR(255) NOT NULL,
   message_body TEXT NOT NULL,
   status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- جدول مرفقات تذاكر التواصل
CREATE TABLE ticket_attachments (
   attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   ticket_id UUID NOT NULL REFERENCES communication_tickets(ticket_id) ON DELETE CASCADE,
   file_path VARCHAR(512) NOT NULL,
   file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT')),
   file_size_bytes BIGINT NOT NULL,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
