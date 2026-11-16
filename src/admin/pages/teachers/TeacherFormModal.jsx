import { useState } from 'react';
import Modal from '../../components/ui/Modal';
import AssignmentSelect from '../groups/AssignmentSelect';
import { parseSubjects } from './teacherAssignment';
import { canSeeEmployeeSalary } from '../../../auth/salaryPrivacy';
import { maskPhoneInput, phoneDigits } from '../../utils/format';
import { GENDERS, formatSchedule } from '../students/studentsData';
import {
  EDUCATION_OPTIONS,
  GROUP_LIST,
  SALARY_TYPES,
  TEACHER_STATUS_OPTIONS,
  findGroupOwner,
  findScheduleConflict,
  teacherName,
} from './teachersData';

const todayIso = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  firstName: '',
  lastName: '',
  gender: 'male',
  birthDate: '',
  phone: '',
  address: '',
  level: '',
  subjects: [],
  groups: [],
  status: 'active',
  hiredAt: '',
  experience: '0',
  education: EDUCATION_OPTIONS[0],
  salaryType: 'percent',
  salaryValue: '40',
  note: '',
};

const toForm = (teacher) =>
  teacher
    ? {
        ...EMPTY,
        ...teacher,
        phone: maskPhoneInput(teacher.phone),
        experience: String(teacher.experience ?? 0),
        salaryValue: String(teacher.salaryValue ?? 0),
      }
    : { ...EMPTY, hiredAt: todayIso() };

const validate = (f) => {
  const e = {};
  if (f.firstName.trim().length < 2) e.firstName = 'Ism kamida 2 ta belgidan iborat bo‘lsin';
  if (f.lastName.trim().length < 2) e.lastName = 'Familiya kamida 2 ta belgidan iborat bo‘lsin';
  if (phoneDigits(f.phone).length !== 12) e.phone = 'Telefon raqamini to‘liq kiriting';
  if (f.birthDate && f.birthDate > todayIso()) e.birthDate = 'Tug‘ilgan sana kelajakda bo‘lishi mumkin emas';
  if (!f.hiredAt) e.hiredAt = 'Ishga kirgan sanani kiriting';
  if (f.subjects.length === 0) e.subjects = 'Kamida bitta fan yozing';
  const exp = Number(f.experience);
  if (!Number.isFinite(exp) || exp < 0 || exp > 60) e.experience = 'Tajriba 0 dan 60 yilgacha bo‘lsin';
  const salary = Number(f.salaryValue);
  if (!Number.isFinite(salary) || salary < 0) e.salaryValue = 'Qiymat manfiy bo‘lishi mumkin emas';
  else if (f.salaryType === 'percent' && salary > 100) e.salaryValue = 'Foiz 100 dan oshmasin';
  const conflict = findScheduleConflict(f.groups);
  if (conflict) e.groups = `${conflict[0]} va ${conflict[1]} guruhlarining dars vaqti bir-biriga to‘g‘ri keladi`;
  return e;
};

const Field = ({ label, required, error, hint, children }) => (
  <label className={error ? 'field has-error' : 'field'}>
    <span className="field__label">
      {label}
      {required && <abbr title="Majburiy">*</abbr>}
    </span>
    {children}
    {error ? <span className="field__error" role="alert">{error}</span> : hint && <span className="field__hint">{hint}</span>}
  </label>
);

/**
 * Ustoz qo‘shish / tahrirlash formasi. `teacher` berilsa — tahrirlash rejimi.
 * Guruh faqat bitta ustozga biriktiriladi: boshqa ustozniki bo‘lsa, tanlab bo‘lmaydi.
 */
const FormBody = ({ teacher, teachers, onClose, onSubmit }) => {
  const isEdit = Boolean(teacher);
  const showSalary = canSeeEmployeeSalary('main', teacher?.id);
  const [form, setForm] = useState(() => toForm(teacher));
  const [subjectsText, setSubjectsText] = useState(() => (teacher?.subjects || []).join(', '));
  const [errors, setErrors] = useState({});

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const bind = (name) => ({
    value: form[name],
    onChange: (e) => set(name, e.target.value),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const subjects = parseSubjects(subjectsText);
    const found = validate({ ...form, subjects });
    setErrors(found);
    if (Object.keys(found).length) {
      document.querySelector('.student-form .has-error .input, .student-form .has-error button')?.focus();
      return;
    }
    onSubmit({
      ...(teacher ?? {}),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      gender: form.gender,
      birthDate: form.birthDate,
      phone: phoneDigits(form.phone),
      address: form.address.trim(),
      level: form.level.trim(),
      subjects,
      groups: form.groups,
      status: form.status,
      hiredAt: form.hiredAt,
      experience: Number(form.experience),
      education: form.education,
      salaryType: form.salaryType,
      salaryValue: Number(form.salaryValue),
      note: form.note.trim(),
    });
  };

  const availableGroups = GROUP_LIST;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Ustozni tahrirlash' : 'Yangi ustoz qo‘shish'}
      subtitle={isEdit ? `${teacherName(teacher)} · ${teacher.id}` : 'Majburiy maydonlar * bilan belgilangan'}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>Bekor qilish</button>
          <button type="submit" form="teacher-form" className="btn btn--primary">
            {isEdit ? 'Saqlash' : 'Ustozni qo‘shish'}
          </button>
        </>
      }
    >
      <form id="teacher-form" className="student-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="student-form__section">
          <legend>Shaxsiy ma'lumotlar</legend>
          <Field label="Ism" required error={errors.firstName}>
            <input className="input" {...bind('firstName')} placeholder="Masalan, Rustam" autoComplete="off" />
          </Field>
          <Field label="Familiya" required error={errors.lastName}>
            <input className="input" {...bind('lastName')} placeholder="Masalan, Karimov" autoComplete="off" />
          </Field>
          <Field label="Jinsi">
            <select className="input" {...bind('gender')}>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.value === 'male' ? 'Erkak' : 'Ayol'}</option>)}
            </select>
          </Field>
          <Field label="Tug‘ilgan sana" error={errors.birthDate}>
            <input type="date" className="input" max={todayIso()} {...bind('birthDate')} />
          </Field>
          <Field label="Telefon" required error={errors.phone}>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => set('phone', maskPhoneInput(e.target.value))}
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              autoComplete="off"
            />
          </Field>
          <Field label="Manzil">
            <input className="input" {...bind('address')} placeholder="Shahar, ko‘cha, uy" autoComplete="off" />
          </Field>
        </fieldset>

        <fieldset className="student-form__section">
          <legend>Kasbiy ma'lumotlar</legend>
          <Field label="Ma'lumoti">
            <select className="input" {...bind('education')}>
              {EDUCATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Tajriba (yil)" error={errors.experience}>
            <input type="number" min="0" max="60" className="input" {...bind('experience')} />
          </Field>
          <Field label="Ishga kirgan sana" required error={errors.hiredAt}>
            <input type="date" className="input" {...bind('hiredAt')} />
          </Field>
          <Field label="Darajasi" hint="Masalan: IELTS 8.0, CEFR C1, oliy toifa">
            <input className="input" {...bind('level')} maxLength={100} placeholder="Darajasini kiriting" />
          </Field>
          <Field label="Holati">
            <select className="input" {...bind('status')}>
              {TEACHER_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <div className="student-form__wide">
            <div className={errors.subjects ? 'field has-error' : 'field'}>
              <span className="field__label">Dars beradigan fanlari<abbr title="Majburiy">*</abbr></span>
              <input className="input" aria-label="Dars beradigan fanlari" value={subjectsText} onChange={(event) => { setSubjectsText(event.target.value); setErrors((previous) => ({ ...previous, subjects: undefined })); }} placeholder="Masalan: Ingliz tili, IELTS, CEFR" />
              <span className="field__hint">Fanlarni o‘zingiz yozing. Bir nechta fanni vergul bilan ajrating.</span>
              {errors.subjects && <span className="field__error" role="alert">{errors.subjects}</span>}
            </div>
          </div>
        </fieldset>

        <fieldset className="student-form__section">
          <legend>Guruhlar va dars jadvali</legend>
          <div className="student-form__wide">
            <div className={errors.groups ? 'field has-error' : 'field'}>
              {availableGroups.length === 0 ? (
                <span className="field__hint">Hozircha faol guruh yo‘q.</span>
              ) : (
                <AssignmentSelect label="Guruh" value={form.groups} options={availableGroups.map((g) => {
                    const owner = findGroupOwner(teachers, g.code, teacher?.id);
                    return { value: g.code, label: `${g.code} · ${g.course} · ${formatSchedule(g.code)}${owner ? ` — Band: ${teacherName(owner)}` : ''}`, disabled: Boolean(owner) };
                  })} onChange={(groups) => set('groups', groups)} />
              )}
              {errors.groups && <span className="field__error" role="alert">{errors.groups}</span>}
            </div>
          </div>
        </fieldset>

        <fieldset className="student-form__section">
          <legend>{showSalary ? 'Ish haqi' : 'Qo‘shimcha ma’lumot'}</legend>
          {showSalary && <>
          <Field label="Hisoblash usuli">
            <select className="input" {...bind('salaryType')}>
              {SALARY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field
            label={form.salaryType === 'percent' ? 'Foiz (%)' : 'Oylik (so‘m)'}
            error={errors.salaryValue}
            hint={form.salaryType === 'percent' ? 'Guruhlardagi faol talabalar to‘lovidan' : undefined}
          >
            <input
              type="number"
              min="0"
              max={form.salaryType === 'percent' ? 100 : undefined}
              step={form.salaryType === 'percent' ? 1 : 100000}
              className="input"
              {...bind('salaryValue')}
            />
          </Field>
          </>}
          <div className="student-form__wide">
            <Field label="Izoh">
              <textarea className="input" rows={3} {...bind('note')} placeholder="Qo‘shimcha ma'lumot…" />
            </Field>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
};

const TeacherFormModal = ({ open, teacher, teachers, onClose, onSubmit }) =>
  open ? (
    <FormBody key={teacher?.id ?? 'new'} teacher={teacher} teachers={teachers} onClose={onClose} onSubmit={onSubmit} />
  ) : null;

export default TeacherFormModal;
