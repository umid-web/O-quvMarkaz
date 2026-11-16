import { SUPPORT_ROLES } from '../support-teachers/supportData';
import { eligiblePeople, mainTeacherProblem, supportProblem, teacherName } from './groupsData';
import AssignmentSelect from './AssignmentSelect';

const TeacherPicker = ({ draft, teachers, supportTeachers, mainId, supportIds, onMain, onSupport, error }) => {
  const mains = eligiblePeople(teachers);
  const supports = eligiblePeople(supportTeachers);
  return <>
    <div className="student-form__wide">
      <label className="field">
        <span className="field__label">Asosiy ustoz</span>
        <select className="input" value={mainId} onChange={(event) => onMain(event.target.value)}>
          <option value="">— Biriktirilmagan —</option>
          {mains.map((teacher) => {
            const problem = mainTeacherProblem(teacher, draft);
            return <option key={teacher.id} value={teacher.id} disabled={Boolean(problem) && teacher.id !== mainId}>
              {teacherName(teacher)} · {(teacher.subjects || []).join(', ')}{problem ? ` — ${problem}` : ''}
            </option>;
          })}
        </select>
        <span className="field__hint">Barcha ustozlardan tanlang. Bir guruhga bitta asosiy ustoz biriktiriladi.</span>
      </label>
    </div>
    <div className="student-form__wide">
      <div className={error ? 'field has-error' : 'field'}>
        <span className="field__label">Qo‘shimcha ustozlar</span>
        <AssignmentSelect label="Qo‘shimcha ustoz" value={supportIds} onChange={onSupport} options={supports.map((person) => {
          const problem = supportProblem(person, draft);
          return { value: person.id, label: `${teacherName(person)} · ${SUPPORT_ROLES[person.role]?.label || 'Ustoz'}${problem ? ` — ${problem}` : ''}`, disabled: Boolean(problem) };
        })} />
        <span className="field__hint">Bir nechta qo‘shimcha ustozni select orqali tanlashingiz mumkin.</span>
        {error && <span className="field__error" role="alert">{error}</span>}
      </div>
    </div>
  </>;
};

export default TeacherPicker;
