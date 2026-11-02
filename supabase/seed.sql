-- Nurra demo seed: Meera (patient), Anita (primary contact), Ravi (secondary), dementia care plan.
-- Run after ALL migrations in supabase/migrations (0001, 0002, 0003, ...), in the Supabase SQL editor.
-- Safe to run twice. (Already ran it after 0001? 0003 converts that data; no need to run it again.)
--
-- This file does not create sign-in users. public.users rows need a Supabase Auth user, which
-- comes from sign-up in Stage S2. All phone numbers below are placeholders: replace them with
-- real WhatsApp numbers in the app before testing alerts.
-- Medicines are seeded as Unverified, as the spec requires. A clinician approves them in the app.

insert into public.households (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Rao family')
on conflict (id) do nothing;

insert into public.patients (id, household_id, full_name, preferred_name, birth_year, language, timezone, status)
values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001',
        'Meera Rao', 'Meera', 1946, 'en', 'Asia/Kolkata', 'draft')
on conflict (id) do nothing;

insert into public.contacts (id, household_id, patient_id, name, relationship, priority, phone, channels)
values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', 'Anita', 'Daughter', 'primary', '+910000000001', '{whatsapp}'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', 'Ravi', 'Son', 'secondary', '+910000000002', '{whatsapp}')
on conflict (id) do nothing;

insert into public.consents (id, household_id, patient_id, basis, given_by, evidence_note)
values ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000010', 'guardian', 'Anita',
        'Demo data: consent recorded by Anita on behalf of Meera.')
on conflict (id) do nothing;

insert into public.conditions (id, household_id, patient_id, name, since, treating_doctor, notes)
values ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000010', 'Mild dementia', '2024-03-01', 'Dr Rao', 'Demo data.')
on conflict (id) do nothing;

insert into public.medications
  (id, household_id, patient_id, brand_name, generic_name, ingredient, strength, dose, frequency, timing, with_food, purpose, prescriber, start_date, status)
values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', 'Amlodac', 'Amlodipine', 'amlodipine', '5 mg', '1 tablet',
   'Once a day', '{08:00}', 'any', 'Blood pressure', 'Dr Rao', '2024-03-01', 'active'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', 'Aricept', 'Donepezil', 'donepezil', '5 mg', '1 tablet',
   'Once a day', '{20:00}', 'after', 'Memory', 'Dr Rao', '2024-03-01', 'active')
on conflict (id) do nothing;

insert into public.care_plans (id, household_id, patient_id, name, preset)
values ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000010', 'Meera daily plan', 'dementia')
on conflict (id) do nothing;

insert into public.care_plan_items
  (id, household_id, patient_id, care_plan_id, item_type, title, severity, medication_id,
   schedule_kind, times_of_day, on_date, details, expires_on)
values
  ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'medication', 'Morning tablet', 'important', '00000000-0000-4000-8000-000000000051',
   'times', '{08:00}', null, null, null),
  ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'meal', 'Breakfast', 'normal', null, 'times', '{08:30}', null, null, null),
  ('00000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'water', 'A glass of water', 'normal', null, 'times', '{11:00}', null, null, null),
  ('00000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'exercise', 'Short walk in the garden', 'normal', null, 'times', '{17:00}', null, null, null),
  ('00000000-0000-4000-8000-000000000075', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'medication', 'Evening tablet', 'critical', '00000000-0000-4000-8000-000000000052',
   'times', '{20:00}', null, null, null),
  ('00000000-0000-4000-8000-000000000076', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'checkin_question', 'How are you feeling today?', 'normal', null, 'times', '{10:00}', null, null, null),
  ('00000000-0000-4000-8000-000000000077', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000060',
   'appointment', 'Anita is visiting on Saturday', 'normal', null, 'once', '{10:00}', current_date + 5,
   'Fact for the greeting. Expires so Nurra stops saying it.', current_date + 7)
on conflict (id) do nothing;

-- Linked plan items remember the medicine as it was when the plan accepted it.
update public.care_plan_items i
   set medication_snapshot = jsonb_build_object(
         'strength', m.strength, 'dose', m.dose, 'frequency', m.frequency,
         'timing', to_jsonb(m.timing), 'status', m.status)
  from public.medications m
 where m.id = i.medication_id and i.medication_snapshot is null;
