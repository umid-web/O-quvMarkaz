import { useMemo, useState } from 'react';
import Modal from '../../components/ui/Modal';
import AssignmentSelect from '../groups/AssignmentSelect';
import { parseSubjects } from '../teachers/teacherAssignment';
import { maskPhoneInput, phoneDigits } from '../../utils/format';
import { GENDERS } from '../students/studentsData';
import { loadTeachers, findTeacherByGroup } from '../teachers/teachersStore';
import { loadGroups } from '../groups/groupsStore';
import { formatGroupSchedule } from '../groups/groupsData';
import { groupsOverlap } from '../teachers/teachersData';
import { canSeeEmployeeSalary } from '../../../auth/salaryPrivacy';
import {
  PAY_TYPES,
  PAY_STATUS_OPTIONS,
  SUPPORT_ROLES,
  SUPPORT_ROLE_OPTIONS,
  SUPPORT_STATUS_OPTIONS,
  WEEK_DAYS,
  teacherName,
} from './supportData';

const todayIso = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  firstName: '',
  lastName: '',
  gender: 'male',
  birthDate: '',
  phone: '',
  address: '',
  role: 'assistant',
  level: '',
  subjects: [],
  groups: [],
  availableDays: [],
  status: 'active',
  startedAt: '',
  payType: 'perLesson',
  payValue: '40000',
  payStatus: 'unpaid',
  note: '',
};

const toForm = (person) =>
  person
    ? {
        ...EMPTY,
        ...person,
        phone: maskPhoneInput(person.phone),
        payValue: String(person.payValue ?? 0),
        payStatus: person.payStatus ?? 'unpaid'
      }
    : { ...EMPTY, startedAt: todayIso() };

const validate = (f, groups) => {
  const e = {};
  if (f.firstName.trim().length < 2) e.firstName = 'Ism kamida 2 ta belgidan iborat bo‘lsin';
  if (f.lastName.trim().length < 2) e.lastName = 'Familiya kamida 2 ta belgidan iborat bo‘lsin';
  if (phoneDigits(f.phone).length !== 12) e.phone = 'Telefon raqamini to‘liq kiriting';
  if (f.birthDate && f.birthDate > todayIso()) e.birthDate = 'Tug‘ilgan sana kelajakda bo‘lishi mumkin emas';
  if (!f.startedAt) e.startedAt = 'Ishga kirgan sanani kiriting';
  if (f.subjects.length === 0) e.subjects = 'Kamida bitta fan yozing';
  const pay = Number(f.payValue);
  if (!Number.isFinite(pay) || pay < 0) e.payValue = 'Qiymat manfiy bo‘lishi mumkin emas';
  const selected = f.groups.map((code) => groups.find((group) => group.code === code)).filter(Boolean);
  let conflict = null;
  for (let i = 0; i < selected.length && !conflict; i++) {
    const other = selected.slice(i + 1).find((group) => groupsOverlap(selected[i], group));
    if (other) conflict = [selected[i].code, other.code];
  }
  if (conflict) {
    e.groups = `${conflict[0]} va ${conflict[1]} guruhlarining dars vaqti bir-biriga to‘g‘ri keladi`;
  } else {
    const off = f.availableDays.length ? selected.find((group) => group.days.some((day) => !f.availableDays.includes(day)))?.code : null;
    if (off) e.groups = `${off} guruhining dars kunlari ustozning ish kunlariga to‘g‘ri kelmaydi`;
  }
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
 * Qo‘shimcha ustoz qo‘shish / tahrirlash formasi. `person` berilsa — tahrirlash rejimi.
 * Asosiy ustozdan farqi: bitta guruhga bir nechta qo‘shimcha ustoz biriktirilishi mumkin.
 */
const FormBody = ({ person, onClose, onSubmit }) => {
  const isEdit = Boolean(person);
  const showSalary = canSeeEmployeeSalary('support', person?.id);
  const allGroups = useMemo(() => loadGroups(), []);
  const [form, setForm] = useState(() => {
    const initial = toForm(person);
    return { ...initial, groups: initial.groups.filter((code) => allGroups.some((group) => group.code === code)) };
  });
  const [subjectsText, setSubjectsText] = useState(() => (person?.subjects || []).join(', '));
  const [errors, setErrors] = useState({});
  const teachers = useMemo(() => loadTeachers(), []);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const bind = (name) => ({ value: form[name], onChange: (e) => set(name, e.target.value) });

  const toggleDay = (day) => {
    setForm((f) => ({
      ...f,
      availableDays: f.availableDays.includes(day) ? f.availableDays.filter((d) => d !== day) : [...f.availableDays, day],
    }));
    setErrors((e) => ({ ...e, groups: undefined }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const subjects = parseSubjects(subjectsText);
    const found = validate({ ...form, subjects }, allGroups);
    if (form.groups.some((code) => !allGroups.some((group) => group.code === code))) found.groups = 'Faqat mavjud guruhni tanlang';
    setErrors(found);
    if (Object.keys(found).length) {
      document.querySelector('.student-form .has-error .input, .student-form .has-error button')?.focus();
      return;
    }
    onSubmit({
      ...(person ?? {}),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      gender: form.gender,
      birthDate: form.birthDate,
      phone: phoneDigits(form.phone),
      address: form.address.trim(),
      role: form.role,
      level: form.level.trim(),
      subjects,
      groups: form.status === 'left' ? [] : form.groups,
      availableDays: [...form.availableDays].sort((a, b) => a - b),
      status: form.status,
      startedAt: form.startedAt,
      payType: form.payType,
      payValue: Number(form.payValue),
      payStatus: form.payStatus,
      note: form.note.trim(),
    });
  };

  const availableGroups = allGroups.filter((group) => group.status !== 'archived' || person?.groups?.includes(group.code));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Qo‘shimcha ustozni tahrirlash' : 'Yangi qo‘shimcha ustoz'}
      subtitle={isEdit ? `${teacherName(person)} · ${person.id}` : 'Majburiy maydonlar * bilan belgilangan'}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>Bekor qilish</button>
          <button type="submit" form="support-teacher-form" className="btn btn--primary">
            {isEdit ? 'Saqlash' : 'Ustozni qo‘shish'}
          </button>
        </>
      }
    >
      <form id="support-teacher-form" className="student-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="student-form__section">
          <legend>Shaxsiy ma'lumotlar</legend>
          <Field label="Ism" required error={errors.firstName}>
            <input className="input" {...bind('firstName')} placeholder="Masalan, Gulnora" autoComplete="off" />
          </Field>
          <Field label="Familiya" required error={errors.lastName}>
            <input className="input" {...bind('lastName')} placeholder="Masalan, Tursunova" autoComplete="off" />
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
          <legend>Lavozimi</legend>
          <Field label="Roli" hint={SUPPORT_ROLES[form.role]?.hint}>
            <select className="input" {...bind('role')}>
              {SUPPORT_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Darajasi" hint="Masalan: IELTS 8.0, CEFR C1, oliy toifa">
            <input className="input" {...bind('level')} maxLength={100} placeholder="Darajasini kiriting" />
          </Field>
          <Field label="Holati">
            <select className="input" {...bind('status')}>
              {SUPPORT_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Ishga kirgan sana" required error={errors.startedAt}>
            <input type="date" className="input" {...bind('startedAt')} />
          </Field>

          <div className="student-form__wide">
            <div className={errors.subjects ? 'field has-error' : 'field'}>
              <span className="field__label">Yordam beradigan fanlari<abbr title="Majburiy">*</abbr></span>
              <input className="input" aria-label="Dars beradigan fanlari" value={subjectsText} onChange={(event) => { setSubjectsText(event.target.value); setErrors((previous) => ({ ...previous, subjects: undefined })); }} placeholder="Masalan: Ingliz tili, IELTS, CEFR" />
              <span className="field__hint">Fanlarni o‘zingiz yozing. Bir nechta fanni vergul bilan ajrating.</span>
              {errors.subjects && <span className="field__error" role="alert">{errors.subjects}</span>}
            </div>
          </div>

          <div className="student-form__wide">
            <div className="field">
              <span className="field__label">Ish kunlari</span>
              <div className="chips" role="group" aria-label="Ish kunlari">
                {WEEK_DAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className={form.availableDays.includes(d.value) ? 'chip is-active' : 'chip'}
                    aria-pressed={form.availableDays.includes(d.value)}
                    onClick={() => toggleDay(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <span className="field__hint">Hech narsa tanlanmasa — ustoz haftaning istalgan kunida ishlay oladi.</span>
            </div>
          </div>
        </fieldset>

        <fieldset className="student-form__section">
          <legend>Guruhlar</legend>
          <div className="student-form__wide">
            <div className={errors.groups ? 'field has-error' : 'field'}>
              {form.status === 'left' ? (
                <span className="field__hint">Ketgan ustozga guruh biriktirilmaydi.</span>
              ) : availableGroups.length === 0 ? (
                <span className="field__hint">Hozircha faol guruh yo‘q. O‘rinbosar ustozga guruh shart emas.</span>
              ) : (
                <AssignmentSelect label="Guruh" value={form.groups} options={availableGroups.map((g) => {
                    const main = findTeacherByGroup(teachers, g.code);
                    return { value: g.code, label: `${g.code} · ${g.course} · ${formatGroupSchedule(g)}${main ? ` · ${teacherName(main)}` : ''}` };
                  })} onChange={(groups) => set('groups', groups)} />
              )}
              {errors.groups && <span className="field__error" role="alert">{errors.groups}</span>}
              {form.status !== 'left' && form.groups.map((code) => {
                const group = allGroups.find((item) => item.code === code);
                if (!group) return null;
                const main = findTeacherByGroup(teachers, code);
                return <details key={code} className="support-group-preview" open>
                  <summary>{code} — Guruh ma’lumotlari</summary>
                  <dl>
                    <div><dt>Kurs</dt><dd>{group.course}</dd></div>
                    <div><dt>Dars jadvali</dt><dd>{formatGroupSchedule(group)}</dd></div>
                    <div><dt>Xona</dt><dd>{group.room || 'Belgilanmagan'}</dd></div>
                    <div><dt>Asosiy ustoz</dt><dd>{main ? teacherName(main) : 'Biriktirilmagan'}</dd></div>
                    <div><dt>Sig‘imi</dt><dd>{group.capacity ? `${group.capacity} talaba` : 'Belgilanmagan'}</dd></div>
                    <div><dt>Holati</dt><dd>{group.status === 'archived' ? 'Arxivda' : 'Faol'}</dd></div>
                  </dl>
                  {group.note && <p>{group.note}</p>}
                </details>;
              })}
            </div>
          </div>
        </fieldset>

        <fieldset className="student-form__section">
          <legend>{showSalary ? 'To‘lov' : 'Qo‘shimcha ma’lumot'}</legend>
          {showSalary && <>
          <Field label="Hisoblash usuli">
            <select className="input" {...bind('payType')}>
              {PAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field
            label={form.payType === 'perLesson' ? 'Bir dars uchun (so‘m)' : 'Oylik (so‘m)'}
            error={errors.payValue}
            hint={form.payType === 'perLesson' ? 'Oylik = bir dars narxi × oydagi darslar soni (haftasiga × 4)' : undefined}
          >
            <input type="number" min="0" step="5000" className="input" {...bind('payValue')} />
          </Field>

          <Field label="To‘lov holati">
            <select className="input" {...bind('payStatus')}>
              {PAY_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
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

const SupportTeacherFormModal = ({ open, person, onClose, onSubmit }) =>
  open ? <FormBody key={person?.id ?? 'new'} person={person} onClose={onClose} onSubmit={onSubmit} /> : null;

export default SupportTeacherFormModal;
