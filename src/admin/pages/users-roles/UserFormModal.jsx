import { useState } from 'react';
import { canSeeEmployeeSalary } from '../../../auth/salaryPrivacy';
import Modal from '../../components/ui/Modal';
import { maskPhoneInput, phoneDigits } from '../../utils/format';
import { USER_STATUS_OPTIONS, summarizePermissions, userName } from './usersData';
import { loadTeachers } from '../teachers/teachersStore';
import { loadSupportTeachers } from '../support-teachers/supportStore';
import { hashPassword } from '../../../auth/passwords';
import { createBackendAccount, getSessionGeneration } from '../../../api/backend';
import { loadSettings } from '../settings/settingsStore';
import { ACCOUNT_OPTIONS, accountOptionLabel, resolveAccountOption } from './accountOptions';
import { formatSom } from '../../utils/format';
import { sessionIdentity } from '../../../api/memoryStore';

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  login: '',
  phone: '',
  roleId: '',
  status: 'active',
  note: '',
  password: '',
  teacherId: '',
  teacherType: 'main',
  monthlySalary: '',
  newRoleName: '',
};

const toForm = (user, defaultRoleId) =>
  user ? { ...EMPTY, ...user, login: user.login || user.email?.split('@')[0] || '', phone: maskPhoneInput(user.phone) } : { ...EMPTY, roleId: defaultRoleId };

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
 * User form. Password is required when creating an account and optional when editing it.
 */
const FormBody = ({ user, users, roles, onClose, onSubmit }) => {
  const isEdit = Boolean(user);
  const [form, setForm] = useState(() => toForm(user, 'admin'));
  const [roleText, setRoleText] = useState(() => accountOptionLabel(user, roles));
  const [teacherQuery, setTeacherQuery] = useState('');
  const [teachers] = useState(() => [
    ...loadTeachers().map((item) => ({ ...item, teacherType: 'main' })),
    ...loadSupportTeachers().map((item) => ({ ...item, teacherType: 'support' })),
  ]);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const passwordMinimum = Number(loadSettings()?.security?.passwordMinLength) || 8;
  const teacherRole = form.roleId === 'teacher';
  const canCreateRole = sessionIdentity.getItem('educontrol_role') === 'owner';
  const availableTeachers = teachers.filter((teacher) => (teacher.status !== 'left' || (teacher.id === form.teacherId && teacher.teacherType === form.teacherType))
    && !users.some((item) => item.id !== user?.id && item.roleId === 'teacher' && item.teacherId === teacher.id && (item.teacherType || 'main') === teacher.teacherType));
  const selectedTeacher = teacherRole ? teachers.find((item) => item.id === form.teacherId && item.teacherType === form.teacherType) : null;
  const filteredTeachers = availableTeachers.filter((item) => item === selectedTeacher || teacherQuery.trim().toLocaleLowerCase('uz').split(/\s+/).every((part) => `${item.lastName} ${item.firstName} ${item.phone || ''} ${item.id}`.toLocaleLowerCase('uz').includes(part)));
  const existingSalary = selectedTeacher ? Number(selectedTeacher.teacherType === 'support' ? selectedTeacher.payValue : selectedTeacher.salaryValue) || 0 : 0;
  const salaryLocked = existingSalary > 0;
  const salaryLabel = selectedTeacher?.teacherType === 'support' && selectedTeacher.payType === 'perLesson' ? `${formatSom(existingSalary)} / dars` : selectedTeacher?.salaryType === 'percent' ? `${existingSalary}%` : `${formatSom(existingSalary)} / oy`;
  const changeRole = (value) => {
    setRoleText(value);
    const choice = resolveAccountOption(value, roles);
    setForm((previous) => ({ ...previous, roleId: choice.roleId, newRoleName: choice.newRoleName || '', teacherType: choice.teacherType,
      ...(previous.roleId !== choice.roleId || previous.teacherType !== choice.teacherType ? { teacherId: '', monthlySalary: '' } : {}),
    }));
    setErrors({});
    setFormError('');
  };
  const selectTeacher = (value) => {
    const teacher = teachers.find((item) => `${item.teacherType}:${item.id}` === value);
    setForm((previous) => ({ ...previous,
      teacherId: teacher?.id || '', teacherType: teacher?.teacherType || previous.teacherType, monthlySalary: '', newRoleName: '',
      ...(teacher ? { firstName: teacher.firstName, lastName: teacher.lastName, phone: maskPhoneInput(teacher.phone || ''), email: teacher.email || '', roleId: 'teacher' } : {}),
    }));
    if (teacher) setRoleText(teacher.teacherType === 'support' ? 'Qo‘shimcha o‘qituvchi' : 'O‘qituvchi');
    setErrors({});
    setFormError('');
  };

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (formError) setFormError('');
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const bind = (name) => ({ value: form[name], onChange: (e) => {
    const value = e.target.value;
    set(name, value);
  } });

  const validate = () => {
    const e = {};
    if (form.firstName.trim().length < 2) e.firstName = 'Ism kamida 2 ta belgidan iborat bo‘lsin';
    if (form.lastName.trim().length < 2) e.lastName = 'Familiya kamida 2 ta belgidan iborat bo‘lsin';
    const email = form.email.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) e.email = 'Email manzilini to‘g‘ri kiriting';
    else if (email && users.some((u) => u.id !== user?.id && String(u.email || '').toLowerCase() === email)) e.email = 'Bu email bilan foydalanuvchi allaqachon mavjud';
    if (form.phone && phoneDigits(form.phone).length !== 12) e.phone = 'Telefon raqamini to‘liq kiriting yoki bo‘sh qoldiring';
    if (!form.roleId && (form.newRoleName.length < 2 || form.newRoleName.length > 80)) e.roleId = 'Rolni tanlang yoki 2–80 belgili yangi rol nomini yozing';
    if (form.roleId === 'owner' && user?.roleId !== 'owner') e.roleId = 'Super admin rolini yangi hisobga berib bo‘lmaydi';
    if (!salaryLocked && form.monthlySalary !== '' && (!Number.isSafeInteger(Number(form.monthlySalary)) || Number(form.monthlySalary) < 0 || Number(form.monthlySalary) > 1_000_000_000)) e.monthlySalary = 'Maosh 0–1 000 000 000 oralig‘idagi butun son bo‘lsin';
    if (form.login.trim().length < 3 || !/^[a-zA-Z0-9._-]+$/.test(form.login.trim())) e.login = 'Login kamida 3 ta belgi bo‘lsin (harf, raqam, nuqta, _ yoki -)';
    else if (users.some((u) => u.id !== user?.id && u.login?.toLowerCase() === form.login.trim().toLowerCase())) e.login = 'Bu login band';
    if (!isEdit && [...form.password].length < passwordMinimum) e.password = `Parol kamida ${passwordMinimum} ta belgidan iborat bo‘lsin`;
    if (form.password && [...form.password].length < passwordMinimum) e.password = `Parol kamida ${passwordMinimum} ta belgidan iborat bo‘lsin`;
    if (form.password.length > 256) e.password = 'Parol ko‘pi bilan 256 belgi bo‘lsin';
    if (form.login.trim().length > 80) e.login = 'Login ko‘pi bilan 80 belgi bo‘lsin';
    return e;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const generation = getSessionGeneration();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      document.querySelector('.student-form .has-error .input')?.focus();
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const teacherId = teacherRole ? form.teacherId : '';
      const payload = {
        ...(user ?? {}),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        login: form.login.trim(),
        phone: phoneDigits(form.phone),
        roleId: form.roleId,
        status: form.status,
        note: form.note.trim(),
        teacherId,
        teacherType: teacherRole ? form.teacherType : '',
        newRoleName: form.newRoleName || undefined,
        monthlySalary: salaryLocked ? (user?.teacherId === selectedTeacher?.id && (user?.teacherType || 'main') === selectedTeacher?.teacherType ? user?.monthlySalary : undefined) : form.monthlySalary === '' ? undefined : Number(form.monthlySalary),
      };
      if (!isEdit) {
        const created = await createBackendAccount({
          username: payload.login,
          password: form.password,
          roleId: payload.roleId,
          status: payload.status,
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          phone: payload.phone,
          teacherId: payload.teacherId,
          teacherType: payload.teacherType,
          note: payload.note,
          roleName: payload.newRoleName,
          monthlySalary: payload.monthlySalary,
        });
        if (generation !== getSessionGeneration()) throw new Error('Sessiya o‘zgardi.');
        await onSubmit(created);
      } else {
        const passwordHash = form.password ? await hashPassword(form.password) : user?.passwordHash;
        if (generation !== getSessionGeneration()) throw new Error('Sessiya o‘zgardi.');
        const updated = { ...payload, ...(passwordHash ? { passwordHash } : {}) };
        await onSubmit(updated);
      }
    } catch (error) {
      setFormError(error.message || 'Foydalanuvchini saqlab bo‘lmadi.');
      setSaving(false);
    }
  };
  const role = roles.find((r) => r.id === form.roleId);
  const summary = role ? summarizePermissions(role) : null;

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      size="lg"
      title={isEdit ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi'}
      subtitle={isEdit ? `${userName(user)} · ${user.id}` : 'Majburiy maydonlar * bilan belgilangan'}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>Bekor qilish</button>
          <button type="submit" form="user-form" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saqlanmoqda…' : isEdit ? 'Saqlash' : 'Foydalanuvchini qo‘shish'}
          </button>
        </>
      }
    >
      <form id="user-form" className="student-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="student-form__section" disabled={saving}>
          <legend>Ustoz profilidan to‘ldirish</legend>
          <Field label="Ustozni qidirish" hint="Ism, familiya, telefon yoki ID yozing">
            <input className="input" type="search" value={teacherQuery} onChange={(event) => setTeacherQuery(event.target.value)} placeholder="Ustozni qidiring…" />
          </Field>
          <Field label="Ro‘yxatdan o‘tmagan ustoz" hint="Asosiy yoki qo‘shimcha ustozni tanlang. Qo‘lda kiritish uchun biriktirilmagan holatda qoldiring.">
            <select className="input" value={selectedTeacher ? `${selectedTeacher.teacherType}:${selectedTeacher.id}` : ''} onChange={(event) => selectTeacher(event.target.value)} disabled={user?.roleId === 'owner'}>
              <option value="">Qo‘lda kiritish — profil biriktirilmagan</option>
              {['main', 'support'].map((type) => <optgroup key={type} label={type === 'main' ? 'Asosiy ustozlar' : 'Qo‘shimcha ustozlar'}>
                {filteredTeachers.filter((item) => item.teacherType === type).map((item) => <option key={`${type}:${item.id}`} value={`${type}:${item.id}`}>{item.lastName} {item.firstName} · {item.id}</option>)}
              </optgroup>)}
            </select>
          </Field>
          {filteredTeachers.length === 0 && <p className="field__hint">Qidiruvga mos ro‘yxatdan o‘tmagan ustoz yo‘q. Ma’lumotlarni quyida qo‘lda kiriting.</p>}
        </fieldset>
        <fieldset className="student-form__section" disabled={saving}>
          <legend>Shaxsiy ma'lumotlar</legend>
          <Field label="Ism" required error={errors.firstName}>
            <input className="input" {...bind('firstName')} placeholder="Masalan, Anvar" maxLength={100} autoComplete="off" data-autofocus />
          </Field>
          <Field label="Familiya" required error={errors.lastName}>
            <input className="input" {...bind('lastName')} placeholder="Masalan, Karimov" maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Login" required error={errors.login} hint="Xodim tizimga login va parol bilan kiradi">
            <input className="input" {...bind('login')} placeholder="Masalan: rustam.karimov" maxLength={80} autoComplete="username" />
          </Field>
          <Field label={isEdit ? 'Yangi parol (ixtiyoriy)' : 'Boshlang‘ich parol'} required={!isEdit} error={errors.password} hint={`Kamida ${passwordMinimum} belgi. Tahrirlashda bo‘sh qoldirsangiz, amaldagi parol saqlanadi.`}>
            <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Telefon" error={errors.phone}>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => set('phone', maskPhoneInput(e.target.value))}
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              autoComplete="off"
            />
          </Field>
          <Field label="Email (ixtiyoriy)" error={errors.email}>
            <input className="input" type="email" {...bind('email')} autoComplete="email" placeholder="Masalan: ustoz@example.com" maxLength={254} />
          </Field>
        </fieldset>

        <fieldset className="student-form__section" disabled={saving}>
          <legend>Kirish huquqi</legend>
          <Field label="Rol" required error={errors.roleId} hint={role?.description || 'Rolni tanlang'}>
            {canCreateRole ? <>
              <input className="input" list="account-role-options" value={roleText} onChange={(event) => changeRole(event.target.value)} disabled={user?.roleId === 'owner'} placeholder="Rolni tanlang yoki boshqa rol nomini yozing" maxLength={80} />
              <datalist id="account-role-options">{ACCOUNT_OPTIONS.map((item) => <option key={item.name} value={item.name} />)}</datalist>
            </> : <select className="input" value={roleText} onChange={(event) => changeRole(event.target.value)} disabled={user?.roleId === 'owner'}>
              {ACCOUNT_OPTIONS.filter((option) => roles.some((item) => item.id === option.roleId)).map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
              {roles.filter((item) => item.id !== 'owner' && !ACCOUNT_OPTIONS.some((option) => option.roleId === item.id)).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>}
          </Field>
          {form.newRoleName && <p className="field__hint">“{form.newRoleName}” nomli rol yaratiladi. Bosh sahifa va xodimlar chatidan foydalanadi; boshqa ruxsatlarni “Rollar va ruxsatlar” bo‘limida belgilang.</p>}
          {teacherRole && !selectedTeacher && <p className="field__hint">Ustoz profili biriktirilmasa hisob ochiladi, guruhlar esa profil tanlangandan keyin ko‘rinadi.</p>}
          <Field
            label="Holati"
            hint={
              form.status === 'blocked'
                  ? 'Bloklangan foydalanuvchi tizimga kira olmaydi'
                  : undefined
            }
          >
            <select className="input" {...bind('status')}>
              {USER_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          
          {summary && (
            <div className="student-form__wide">
              <p className="role-preview">
                <strong>{role.name}</strong> roli: {summary.modules.length} ta bo‘lim, {summary.count} ta ruxsat.
                Ruxsatlarni “Rollar va ruxsatlar” bo‘limida o‘zgartirish mumkin.
              </p>
            </div>
          )}
          <div className="student-form__wide">
            <Field label="Izoh">
              <textarea className="input" rows={3} maxLength={1000} {...bind('note')} placeholder="Lavozimi yoki qo‘shimcha ma'lumot…" />
            </Field>
          </div>
        </fieldset>
        {canSeeEmployeeSalary('user', user?.id) && <fieldset className="student-form__section" disabled={saving}>
          <legend>Ish haqi</legend>
          {salaryLocked ? <p className="field__hint">Profilida maosh belgilangan: <strong>{salaryLabel}</strong>. Uni tegishli ustoz profilida tahrirlash mumkin.</p> : <Field label="Oylik maosh (so‘m)" error={errors.monthlySalary} hint="Maosh belgilanmagan bo‘lsa kiriting. Bo‘sh qoldirish mumkin; bu to‘lov amalga oshirilganini bildirmaydi.">
            <input className="input" type="number" min="0" max="1000000000" step="1000" value={form.monthlySalary} onChange={(event) => set('monthlySalary', event.target.value)} placeholder="Masalan: 3000000" />
          </Field>}
        </fieldset>}
        {formError && <p className="field__error" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
};

const UserFormModal = ({ open, user, users, roles, onClose, onSubmit }) =>
  open ? <FormBody key={user?.id ?? 'new'} user={user} users={users} roles={roles} onClose={onClose} onSubmit={onSubmit} /> : null;

export default UserFormModal;

